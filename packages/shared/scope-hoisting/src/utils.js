// @flow
import type {
  Asset,
  BundleGraph,
  MutableAsset,
  NamedBundle,
} from '@parcel/types';
import type {NodePath, Scope, VariableDeclarationKind} from '@babel/traverse';
import type {
  ClassDeclaration,
  FunctionDeclaration,
  Identifier,
  ImportDefaultSpecifier,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  Node,
  VariableDeclarator,
  Statement,
} from '@babel/types';
import {parse as babelParse} from '@babel/parser';
import type {Diagnostic} from '@parcel/diagnostic';

import {simple as walkSimple} from '@parcel/babylon-walk';
import ThrowableDiagnostic from '@parcel/diagnostic';
import * as t from '@babel/types';
import {
  isIdentifier,
  isFunctionDeclaration,
  isVariableDeclarator,
  isVariableDeclaration,
} from '@babel/types';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import path from 'path';
import fs from 'fs';

export function getName(
  asset: Asset | MutableAsset,
  type: string,
  ...rest: Array<string>
): string {
  return t.toIdentifier(
    '$' + asset.id + '$' + type + (rest.length ? '$' + rest.join('$') : ''),
  );
}

export function getIdentifier(
  asset: Asset | MutableAsset,
  type: string,
  ...rest: Array<string>
): BabelNodeIdentifier {
  return t.identifier(getName(asset, type, ...rest));
}

export function getExportIdentifier(
  asset: Asset | MutableAsset,
  name: string,
): BabelNodeIdentifier {
  return getIdentifier(asset, 'export', name);
}

export function needsPrelude(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
): boolean {
  if (bundle.env.outputFormat !== 'global') {
    return false;
  }

  // If this is an entry bundle and it is referenced by other bundles,
  // we need to add the prelude code, which allows registering modules dynamically at runtime.

  return (
    isEntry(bundle, bundleGraph) &&
    // If this bundle has an async descendant, it will use the JSRuntime,
    // which uses parcelRequire. It's also possible that the descendant needs
    // to register exports for its own descendants.
    (hasAsyncDescendant(bundle, bundleGraph) ||
      // If an asset in this bundle is referenced, this bundle will use
      //`parcelRequire.register` to register the asset.
      isReferenced(bundle, bundleGraph))
  );
}

export function isEntry(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
): boolean {
  // If there is no parent JS bundle (e.g. in an HTML page), or environment is isolated (e.g. worker)
  // then this bundle is an "entry"
  return (
    !bundleGraph.hasParentBundleOfType(bundle, 'js') ||
    bundle.env.isIsolated() ||
    !!bundle.getMainEntry()?.isIsolated
  );
}

export function isReferenced(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
): boolean {
  let isReferenced = false;
  bundle.traverseAssets((asset, _, actions) => {
    // A bundle is potentially referenced if any of its assets is referenced
    // by any of its siblings, descendants, siblings of descendants, or
    // descendants of siblings.
    if (bundleGraph.isAssetReferencedByDependant(bundle, asset)) {
      isReferenced = true;
      actions.stop();
      return;
    }
  });

  return isReferenced;
}

export function hasAsyncDescendant(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
): boolean {
  let _hasAsyncDescendant = false;
  bundleGraph.traverseBundles((b, _, actions) => {
    if (b.id === bundle.id) {
      return;
    }

    if (b.env.context !== bundle.env.context || b.type !== 'js') {
      actions.skipChildren();
      return;
    }

    if (b.getMainEntry()) {
      _hasAsyncDescendant = true;
      actions.stop();
      return;
    }
  }, bundle);

  return _hasAsyncDescendant;
}

export function needsDefaultInterop(
  bundleGraph: BundleGraph<NamedBundle>,
  bundle: NamedBundle,
  asset: Asset,
): boolean {
  let deps = bundleGraph.getIncomingDependencies(asset);
  if (asset.meta.isCommonJS && !asset.symbols.hasExportSymbol('default')) {
    return deps.some(
      dep =>
        bundle.hasDependency(dep) &&
        dep.meta.isES6Module &&
        dep.symbols.hasExportSymbol('default'),
    );
  }

  return false;
}

export function assertString(v: mixed): string {
  invariant(typeof v === 'string');
  return v;
}

const DereferenceVisitor = {
  Identifier(node: Identifier, scope: Scope) {
    dereferenceIdentifier(node, scope);
  },
};

// updates bindings in path.scope.getProgramParent()
export function pathDereference(path: NodePath<Node>) {
  walkSimple(path.node, DereferenceVisitor, path.scope.getProgramParent());
}

// like path.remove(), but updates bindings in path.scope.getProgramParent()
export function pathRemove(path: NodePath<Node>) {
  pathDereference(path);
  path.remove();
}

export function dereferenceIdentifier(node: Identifier, scope: Scope) {
  let binding = scope.getBinding(node.name);
  if (binding) {
    let i = binding.referencePaths.findIndex(v => v.node === node);
    if (i >= 0) {
      binding.dereference();
      binding.referencePaths.splice(i, 1);
    }

    let j = binding.constantViolations.findIndex(v =>
      Object.values(v.getBindingIdentifiers()).includes(node),
    );
    if (j >= 0) {
      binding.constantViolations.splice(j, 1);
      if (binding.constantViolations.length == 0) {
        binding.constant = true;
      }
    }
  }
}

export function removeReplaceBinding(
  scope: Scope,
  name: string,
  newPath: NodePath<
    | VariableDeclarator
    | ClassDeclaration
    | FunctionDeclaration
    | ImportSpecifier
    | ImportDefaultSpecifier
    | ImportNamespaceSpecifier,
  >,
  newKind?: VariableDeclarationKind,
) {
  let binding = nullthrows(scope.getBinding(name));
  let path = binding.path;
  let {node, parent} = path;
  invariant(
    isVariableDeclarator(node) && isVariableDeclaration(parent) && !node.init,
  );

  // `path.remove()`ing a declaration also removes the corresponding binding. But we want to keep
  // the binding and only replace the declaration. path._remove() merely removes the node in the AST.
  // $FlowFixMe
  path._remove();
  if (parent.declarations.length === 0) {
    path.parentPath.remove();
  }

  binding.path = newPath;
  binding.identifier = newPath.getBindingIdentifiers()[name];
  if (newKind) {
    binding.kind = newKind;
  }
}

export function verifyScopeState(scope: Scope) {
  let oldBindings = scope.bindings;
  scope.crawl();
  let newBindings = scope.bindings;

  invariant(
    Object.keys(oldBindings).length === Object.keys(newBindings).length,
  );
  for (let name of Object.keys(newBindings)) {
    invariant(newBindings[name], name);
    let {
      scope: aScope,
      constantViolations: aConstantViolations,
      referencePaths: aReferencePaths,
      identifier: aId,
      path: aPath,
      ...a
    } = oldBindings[name];
    let {
      scope: bScope,
      constantViolations: bConstantViolations,
      referencePaths: bReferencePaths,
      identifier: bId,
      path: bPath,
      ...b
    } = newBindings[name];
    invariant(aPath === bPath, name);
    invariant(aId === bId, name);
    invariant(aScope === bScope, name);
    invariant.deepStrictEqual(a, b, name);

    invariant(aConstantViolations.length === bConstantViolations.length, name);
    for (let p of bConstantViolations) {
      invariant(aConstantViolations.indexOf(p) >= 0, name);
    }
    invariant(aReferencePaths.length === bReferencePaths.length, name);
    for (let p of bReferencePaths) {
      invariant(aReferencePaths.indexOf(p) >= 0, name);
    }
  }
}

export function getThrowableDiagnosticForNode(
  message: string,
  filePath: ?string,
  loc: ?{
    +start: {|
      +line: number,
      +column: number,
    |},
    +end: {|
      +line: number,
      +column: number,
    |},
    ...
  },
): ThrowableDiagnostic {
  let diagnostic: Diagnostic = {
    message,
    language: 'js',
  };

  if (filePath) {
    diagnostic.filePath = path.normalize(filePath);
  }
  if (loc) {
    diagnostic.codeFrame = {
      codeHighlights: [
        {
          start: loc.start,
          end: loc.end,
        },
      ],
    };
  }
  return new ThrowableDiagnostic({
    diagnostic,
  });
}

export function parse(code: string, sourceFilename: string): Array<Statement> {
  let ast = babelParse(code, {
    sourceFilename,
    allowReturnOutsideFunction: true,
    plugins: ['dynamicImport'],
  });

  return ast.program.body;
}

let helpersCache;
export function getHelpers(): Map<string, BabelNode> {
  if (helpersCache != null) {
    return helpersCache;
  }

  let helpersPath = path.join(__dirname, 'helpers.js');
  let statements = parse(fs.readFileSync(helpersPath, 'utf8'), helpersPath);

  helpersCache = new Map();
  for (let statement of statements) {
    if (isVariableDeclaration(statement)) {
      if (
        statement.declarations.length !== 1 ||
        !isIdentifier(statement.declarations[0].id)
      ) {
        throw new Error('Unsupported helper');
      }

      helpersCache.set(statement.declarations[0].id.name, statement);
    } else if (isFunctionDeclaration(statement) && isIdentifier(statement.id)) {
      helpersCache.set(statement.id.name, statement);
    } else {
      throw new Error('Unsupported helper');
    }
  }

  return helpersCache;
}

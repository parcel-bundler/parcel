// @flow
import type {Asset, MutableAsset, Bundle, BundleGraph} from '@parcel/types';
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
} from '@babel/types';

import {simple as walkSimple} from '@parcel/babylon-walk';
import * as t from '@babel/types';
import {isVariableDeclarator, isVariableDeclaration} from '@babel/types';
import invariant from 'assert';
import nullthrows from 'nullthrows';

export function getName(
  asset: Asset | MutableAsset,
  type: string,
  ...rest: Array<string>
) {
  return (
    '$' +
    t.toIdentifier(asset.id) +
    '$' +
    type +
    (rest.length
      ? '$' +
        rest
          .map(name => (name === 'default' ? name : t.toIdentifier(name)))
          .join('$')
      : '')
  );
}

export function getIdentifier(
  asset: Asset | MutableAsset,
  type: string,
  ...rest: Array<string>
) {
  return t.identifier(getName(asset, type, ...rest));
}

export function getExportIdentifier(asset: Asset | MutableAsset, name: string) {
  return getIdentifier(asset, 'export', name);
}

export function needsPrelude(bundle: Bundle, bundleGraph: BundleGraph) {
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

export function isEntry(bundle: Bundle, bundleGraph: BundleGraph) {
  // If there is no parent JS bundle (e.g. in an HTML page), or environment is isolated (e.g. worker)
  // then this bundle is an "entry"
  return (
    !bundleGraph.hasParentBundleOfType(bundle, 'js') || bundle.env.isIsolated()
  );
}

export function isReferenced(bundle: Bundle, bundleGraph: BundleGraph) {
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
  bundle: Bundle,
  bundleGraph: BundleGraph,
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

function dereferenceIdentifier(node, scope) {
  let binding = scope.getBinding(node.name);
  if (binding) {
    let i = binding.referencePaths.findIndex(v => v.node === node);
    if (i >= 0) {
      binding.dereference();
      binding.referencePaths.splice(i, 1);
      return;
    }

    let j = binding.constantViolations.findIndex(v =>
      Object.values(v.getBindingIdentifiers()).includes(node),
    );
    if (j >= 0) {
      binding.constantViolations.splice(j, 1);
      if (binding.constantViolations.length == 0) {
        binding.constant = true;
      }
      return;
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

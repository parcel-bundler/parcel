// @flow strict-local

import type {Asset, Bundle, BundleGraph, NamedBundle} from '@parcel/types';
import type {Scope} from '@parcel/babylon-walk';
import type {ExternalBundle, ExternalModule} from '../types';
import type {
  LVal,
  Expression,
  Statement,
  VariableDeclaration,
} from '@babel/types';

import * as t from '@babel/types';
import template from '@babel/template';
import {isExpressionStatement, isVariableDeclaration} from '@babel/types';
import {relativeBundlePath} from '@parcel/utils';
import {assertString, getName, getIdentifier} from '../utils';

const DEFAULT_INTEROP_TEMPLATE = template.statement<
  {|
    NAME: LVal,
    MODULE: Expression,
  |},
  VariableDeclaration,
>('var NAME = $parcel$interopDefault(MODULE);');

export function generateBundleImports(
  bundleGraph: BundleGraph<NamedBundle>,
  from: NamedBundle,
  {bundle, assets}: ExternalBundle,
  // eslint-disable-next-line no-unused-vars
  scope: Scope,
): {|hoisted: Array<Statement>, imports: Array<Statement>|} {
  let specifiers = [];
  let interops = [];
  for (let asset of assets) {
    let id = getName(asset, 'init');
    specifiers.push(t.importSpecifier(t.identifier(id), t.identifier(id)));

    if (asset.meta.isCommonJS === true) {
      let deps = bundleGraph.getIncomingDependencies(asset);
      let hasDefaultInterop = deps.some(
        dep =>
          dep.symbols.hasExportSymbol('default') && from.hasDependency(dep),
      );
      if (hasDefaultInterop) {
        interops.push(
          DEFAULT_INTEROP_TEMPLATE({
            NAME: getIdentifier(asset, '$interop$default'),
            MODULE: t.callExpression(getIdentifier(asset, 'init'), []),
          }),
        );

        scope.add('$parcel$interopDefault');
      }
    }
  }

  return {
    hoisted: [
      t.importDeclaration(
        specifiers,
        t.stringLiteral(relativeBundlePath(from, bundle)),
      ),
      ...interops,
    ],
    imports: [],
  };
}

export function generateExternalImport(
  bundle: Bundle,
  external: ExternalModule,
  // eslint-disable-next-line no-unused-vars
  scope: Scope,
): Array<Statement> {
  let {source, specifiers, isCommonJS} = external;
  let defaultSpecifier = null;
  let namespaceSpecifier = null;
  let namedSpecifiers = [];
  for (let [imported, symbol] of specifiers) {
    if (imported === 'default' || isCommonJS) {
      defaultSpecifier = t.importDefaultSpecifier(t.identifier(symbol));
    } else if (imported === '*') {
      namespaceSpecifier = t.importNamespaceSpecifier(t.identifier(symbol));
    } else {
      namedSpecifiers.push(
        t.importSpecifier(t.identifier(symbol), t.identifier(imported)),
      );
    }
  }

  let statements: Array<Statement> = [];

  // ESModule syntax allows combining default and namespace specifiers, or default and named, but not all three.

  if (namespaceSpecifier) {
    let s = [namespaceSpecifier];
    if (defaultSpecifier) {
      s.unshift(defaultSpecifier);
    }
    statements.push(t.importDeclaration(s, t.stringLiteral(source)));
  } else if (defaultSpecifier) {
    namedSpecifiers.unshift(defaultSpecifier);
  }

  if (namedSpecifiers.length > 0 || statements.length === 0) {
    statements.push(
      t.importDeclaration(namedSpecifiers, t.stringLiteral(source)),
    );
  }

  return statements;
}

export function generateBundleExports(
  bundleGraph: BundleGraph<NamedBundle>,
  bundle: NamedBundle,
  referencedAssets: Set<Asset>,
  scope: Scope,
  reexports: Set<{|exportAs: string, local: string|}>,
): Array<Statement> {
  let statements = [];

  if (referencedAssets.size > 0 || reexports.size > 0) {
    statements.push(
      t.exportNamedDeclaration(
        null,
        [...referencedAssets]
          .map(asset => {
            let name = getName(asset, 'init');
            return t.exportSpecifier(t.identifier(name), t.identifier(name));
          })
          .concat(
            [...reexports].map(exp =>
              t.exportSpecifier(
                t.identifier(exp.local),
                t.identifier(exp.exportAs),
              ),
            ),
          ),
      ),
    );
  }

  // If the main entry is a CommonJS asset, export its `module.exports` property as the `default` export
  let entry = bundle.getMainEntry();
  if (entry?.meta.isCommonJS === true) {
    statements.push(
      t.exportDefaultDeclaration(
        t.identifier(assertString(entry.meta.exportsIdentifier)),
      ),
    );
  }

  return statements;
}

export function generateMainExport(
  node: BabelNode,
  exported: Array<{|exportAs: string, local: string|}>,
): Array<BabelNode> {
  if (isExpressionStatement(node)) {
    return [node];
  }

  let statements = [];

  let bindingIdentifiers = t.getBindingIdentifiers(node);
  let ids: Array<string> = Object.keys(bindingIdentifiers);

  // Export '*' (re-exported CJS exports object) as default
  let defaultExport = exported.find(
    e => e.exportAs === 'default' || e.exportAs === '*',
  );
  let namedExports = exported.filter(
    e => e.exportAs !== 'default' && e.exportAs !== '*',
  );

  if (exported.length === 1 && defaultExport && !isVariableDeclaration(node)) {
    // If there's only a default export, then export the declaration directly.
    // $FlowFixMe - we don't need to worry about type declarations here.
    statements.push(t.exportDefaultDeclaration(node));
  } else if (
    namedExports.length === exported.length &&
    namedExports.length === ids.length &&
    namedExports.every(({exportAs, local}) => exportAs === local)
  ) {
    // If there's only named exports, all of the ids are exported,
    // and none of them are renamed, export the declaration directly.
    statements.push(t.exportNamedDeclaration(node, []));
  } else {
    // Otherwise, add a default export and named export for the identifiers after the original declaration.
    statements.push(node);

    if (defaultExport) {
      statements.push(
        t.exportDefaultDeclaration(t.identifier(defaultExport.local)),
      );
    }

    if (namedExports.length > 0) {
      statements.push(
        t.exportNamedDeclaration(
          null,
          namedExports.map(e =>
            t.exportSpecifier(t.identifier(e.local), t.identifier(e.exportAs)),
          ),
        ),
      );
    }
  }

  return statements;
}

// @flow

import type {Asset, Bundle, BundleGraph, Symbol} from '@parcel/types';
import type {ExternalModule} from '../types';
import * as t from '@babel/types';
import {relativeBundlePath} from '@parcel/utils';
import nullthrows from 'nullthrows';
import invariant from 'assert';
import rename from '../renamer';

export function generateBundleImports(
  from: Bundle,
  bundle: Bundle,
  assets: Set<Asset>
) {
  let specifiers = [...assets].map(asset => {
    let id = t.identifier(asset.meta.exportsIdentifier);
    return t.importSpecifier(id, id);
  });

  return [
    t.importDeclaration(
      specifiers,
      t.stringLiteral(relativeBundlePath(from, bundle))
    )
  ];
}

export function generateExternalImport(
  bundle: Bundle,
  external: ExternalModule
) {
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
        t.importSpecifier(t.identifier(symbol), t.identifier(imported))
      );
    }
  }

  let statements = [];

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
      t.importDeclaration(namedSpecifiers, t.stringLiteral(source))
    );
  }

  return statements;
}

export function generateExports(
  bundleGraph: BundleGraph,
  bundle: Bundle,
  referencedAssets: Set<Asset>,
  path: any,
  replacements: Map<Symbol, Symbol>
) {
  let exportedIdentifiers = new Map();
  let entry = bundle.getMainEntry();
  if (entry) {
    for (let {exportSymbol, symbol} of bundleGraph.getExportedSymbols(entry)) {
      if (symbol) {
        symbol = replacements.get(symbol) || symbol;
      }

      // Map CommonJS module.exports assignments to default ESM exports for interop
      if (exportSymbol === '*') {
        exportSymbol = 'default';
      }

      // If there is an existing binding with the exported name (e.g. an import),
      // rename it so we can use the name for the export instead.
      if (path.scope.hasBinding(exportSymbol) && exportSymbol !== symbol) {
        rename(path.scope, exportSymbol, path.scope.generateUid(exportSymbol));
      }

      exportedIdentifiers.set(symbol, exportSymbol);
    }
  }

  for (let asset of referencedAssets) {
    let exportsId = asset.meta.exportsIdentifier;
    invariant(typeof exportsId === 'string');
    exportedIdentifiers.set(exportsId, exportsId);
  }

  let exported = new Set<Symbol>();

  path.traverse({
    Declaration(path) {
      if (path.isExportDeclaration() || path.parentPath.isExportDeclaration()) {
        return;
      }

      let bindingIdentifiers = path.getBindingIdentifierPaths(false, true);
      let ids = Object.keys(bindingIdentifiers);
      if (ids.length === 0) {
        return;
      }

      let exportedIds = ids.filter(
        id =>
          exportedIdentifiers.has(id) &&
          exportedIdentifiers.get(id) !== 'default'
      );
      let defaultExport = ids.find(
        id => exportedIdentifiers.get(id) === 'default'
      );

      // If all exports in the binding are named exports, export the entire declaration.
      // Also rename all of the identifiers to their exported name.
      if (exportedIds.length === ids.length && !path.isImportDeclaration()) {
        path.replaceWith(t.exportNamedDeclaration(path.node, []));
        for (let id of exportedIds) {
          let exportName = nullthrows(exportedIdentifiers.get(id));
          rename(path.scope, id, exportName);
          exported.add(exportName);
        }

        // If there is only a default export, export the entire declaration.
      } else if (
        ids.length === 1 &&
        defaultExport &&
        !path.isVariableDeclaration() &&
        !path.isImportDeclaration()
      ) {
        path.replaceWith(t.exportDefaultDeclaration(path.node));

        // Otherwise, add export statements after for each identifier.
      } else {
        if (defaultExport) {
          let binding = path.scope.getBinding(defaultExport);
          let insertPath = path;
          if (binding && !binding.constant) {
            insertPath =
              binding.constantViolations[binding.constantViolations.length - 1];
          }

          insertPath.insertAfter(
            t.exportDefaultDeclaration(t.identifier(defaultExport))
          );
        }

        if (exportedIds.length > 0) {
          let specifiers = [];
          for (let id of exportedIds) {
            let exportName = nullthrows(exportedIdentifiers.get(id));
            rename(path.scope, id, exportName);
            exported.add(exportName);
            specifiers.push(
              t.exportSpecifier(
                t.identifier(exportName),
                t.identifier(exportName)
              )
            );
          }

          path.insertAfter(t.exportNamedDeclaration(null, specifiers));
        }
      }
    }
  });

  return exported;
}

// @flow

import type {
  Asset,
  Bundle,
  BundleGraph,
  PluginOptions,
  Symbol,
} from '@parcel/types';
import type {ExternalModule} from '../types';
import * as t from '@babel/types';
import {relativeBundlePath} from '@parcel/utils';
import nullthrows from 'nullthrows';
import invariant from 'assert';
import {relative} from 'path';
import ThrowableDiagnostic from '@parcel/diagnostic';
import rename from '../renamer';
import {assertString} from '../utils';

export function generateBundleImports(
  from: Bundle,
  bundle: Bundle,
  assets: Set<Asset>,
) {
  let specifiers = [...assets].map(asset => {
    let id = t.identifier(assertString(asset.meta.exportsIdentifier));
    return t.importSpecifier(id, id);
  });

  return [
    t.importDeclaration(
      specifiers,
      t.stringLiteral(relativeBundlePath(from, bundle)),
    ),
  ];
}

export function generateExternalImport(
  bundle: Bundle,
  external: ExternalModule,
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
        t.importSpecifier(t.identifier(symbol), t.identifier(imported)),
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
      t.importDeclaration(namedSpecifiers, t.stringLiteral(source)),
    );
  }

  return statements;
}

export function generateExports(
  bundleGraph: BundleGraph,
  bundle: Bundle,
  referencedAssets: Set<Asset>,
  path: any,
  replacements: Map<Symbol, Symbol>,
  options: PluginOptions,
) {
  // maps the bundles's export symbols to the bindings
  let exportedIdentifiers = new Map<Symbol, Symbol>();
  let entry = bundle.getMainEntry();
  if (entry) {
    for (let {exportSymbol, symbol, asset} of bundleGraph.getExportedSymbols(
      entry,
    )) {
      if (!symbol) {
        let relativePath = relative(options.inputFS.cwd(), asset.filePath);
        throw new ThrowableDiagnostic({
          diagnostic: {
            message: `${relativePath} does not export '${exportSymbol}'`,
            filePath: entry.filePath,
            // TODO: add codeFrame when AST from transformers is reused
          },
        });
      }

      symbol = replacements.get(symbol) || symbol;

      // Map CommonJS module.exports assignments to default ESM exports for interop
      if (exportSymbol === '*') {
        exportSymbol = 'default';
      }

      // If there is an existing binding with the exported name (e.g. an import),
      // rename it so we can use the name for the export instead.
      if (path.scope.hasBinding(exportSymbol) && exportSymbol !== symbol) {
        rename(path.scope, exportSymbol, path.scope.generateUid(exportSymbol));
      }

      exportedIdentifiers.set(exportSymbol, symbol);
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
      let ids: Array<string> = Object.keys(bindingIdentifiers);
      if (ids.length === 0) {
        return;
      }
      ids.sort();

      let exportedIdentifiersFiltered = [...exportedIdentifiers.entries()]
        .filter(
          ([exportSymbol, symbol]) =>
            exportSymbol !== 'default' && ids.includes(symbol),
        )
        .sort(([, a], [, b]) => (a > b ? -1 : a < b ? 1 : 0));
      let exportedSymbolsBindings = exportedIdentifiersFiltered.map(
        ([, symbol]) => symbol,
      );
      let exportedSymbols = exportedIdentifiersFiltered.map(
        ([exportSymbol]) => exportSymbol,
      );

      let defaultExport = exportedIdentifiers.get('default');
      if (!ids.includes(defaultExport)) {
        defaultExport = null;
      }

      // If all exports in the binding are named exports, export the entire declaration.
      // Also rename all of the identifiers to their exported name.
      if (
        areArraysStrictlyEqual(ids, exportedSymbolsBindings) &&
        !path.isImportDeclaration()
      ) {
        path.replaceWith(t.exportNamedDeclaration(path.node, []));
        for (let sym of exportedSymbols) {
          let id = nullthrows(exportedIdentifiers.get(sym));
          id = replacements.get(id) || id;
          rename(path.scope, id, sym);
          replacements.set(id, sym);
          exported.add(sym);
        }

        // If the default export is part of the declaration, add it as well
        if (defaultExport) {
          defaultExport = replacements.get(defaultExport) || defaultExport;
          let binding = path.scope.getBinding(defaultExport);
          let insertPath = path;
          if (binding && !binding.constant) {
            insertPath =
              binding.constantViolations[binding.constantViolations.length - 1];
          }

          let [decl] = insertPath.insertAfter(
            t.exportDefaultDeclaration(t.identifier(defaultExport)),
          );
          binding.reference(decl.get('declaration'));
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
          defaultExport = replacements.get(defaultExport) || defaultExport;
          let binding = path.scope.getBinding(defaultExport);
          let insertPath = path;
          if (binding && !binding.constant) {
            insertPath =
              binding.constantViolations[binding.constantViolations.length - 1];
          }

          let [decl] = insertPath.insertAfter(
            t.exportDefaultDeclaration(t.identifier(defaultExport)),
          );
          binding.reference(decl.get('declaration'));
        }

        if (exportedSymbols.length > 0) {
          let [decl] = path.insertAfter(t.exportNamedDeclaration(null, []));
          for (let sym of exportedSymbols) {
            let id = nullthrows(exportedIdentifiers.get(sym));
            id = replacements.get(id) || id;
            rename(path.scope, id, sym);
            replacements.set(id, sym);

            exported.add(sym);
            let [spec] = decl.unshiftContainer('specifiers', [
              t.exportSpecifier(t.identifier(sym), t.identifier(sym)),
            ]);
            path.scope.getBinding(sym).reference(spec.get('local'));
          }
        }
      }
    },
  });

  return exported;
}

function areArraysStrictlyEqual<T>(a: Array<T>, b: Array<T>) {
  return (
    a.length === b.length &&
    a.every(function(a_v, i) {
      return a_v === b[i];
    })
  );
}

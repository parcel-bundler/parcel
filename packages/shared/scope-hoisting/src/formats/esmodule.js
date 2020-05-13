// @flow strict-local

import type {
  Asset,
  Bundle,
  BundleGraph,
  NamedBundle,
  PluginOptions,
  Symbol,
} from '@parcel/types';
import type {NodePath} from '@babel/traverse';
import type {
  ClassDeclaration,
  FunctionDeclaration,
  Identifier,
  ImportDeclaration,
  Program,
} from '@babel/types';
import type {ExternalBundle, ExternalModule} from '../types';

import * as t from '@babel/types';
import {
  isClassDeclaration,
  isFunctionDeclaration,
  isImportDeclaration,
  isVariableDeclaration,
} from '@babel/types';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import {relative} from 'path';
import {relativeBundlePath} from '@parcel/utils';
import rename from '../renamer';
import {
  getName,
  removeReplaceBinding,
  getThrowableDiagnosticForNode,
  verifyScopeState,
} from '../utils';

export function generateBundleImports(
  from: NamedBundle,
  {bundle, assets}: ExternalBundle,
  path: NodePath<Program>,
) {
  let specifiers = [...assets].map(asset => {
    let id = getName(asset, 'init');
    return t.importSpecifier(t.identifier(id), t.identifier(id));
  });

  let [decl] = path.unshiftContainer('body', [
    t.importDeclaration(
      specifiers,
      t.stringLiteral(relativeBundlePath(from, bundle)),
    ),
  ]);
  for (let spec of decl.get<Array<NodePath<BabelNodeImportSpecifier>>>(
    'specifiers',
  )) {
    removeReplaceBinding(path.scope, spec.node.local.name, spec, 'module');
  }
}

export function generateExternalImport(
  bundle: Bundle,
  external: ExternalModule,
  path: NodePath<Program>,
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

  let statements: Array<ImportDeclaration> = [];

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

  let decls = path.unshiftContainer('body', statements);
  for (let decl of decls) {
    let specifiers = decl.get<
      Array<
        NodePath<
          | BabelNodeImportSpecifier
          | BabelNodeImportDefaultSpecifier
          | BabelNodeImportNamespaceSpecifier,
        >,
      >,
    >('specifiers');
    for (let specifier of specifiers) {
      for (let name of Object.keys(specifier.getBindingIdentifiers())) {
        removeReplaceBinding(path.scope, name, specifier, 'module');
      }
    }
  }
}

export function generateExports(
  bundleGraph: BundleGraph<NamedBundle>,
  bundle: Bundle,
  referencedAssets: Set<Asset>,
  programPath: NodePath<Program>,
  replacements: Map<Symbol, Symbol>,
  options: PluginOptions,
) {
  // maps the bundles's export symbols to the bindings
  let exportedIdentifiers = new Map<Symbol, Symbol>();
  let entry = bundle.getMainEntry();
  if (entry) {
    for (let {
      exportAs,
      exportSymbol,
      symbol,
      asset,
      loc,
    } of bundleGraph.getExportedSymbols(entry)) {
      if (symbol != null) {
        symbol = replacements.get(symbol) || symbol;

        // Map CommonJS module.exports assignments to default ESM exports for interop
        if (exportAs === '*') {
          exportAs = 'default';
        }

        // If there is an existing binding with the exported name (e.g. an import),
        // rename it so we can use the name for the export instead.
        if (programPath.scope.hasBinding(exportAs) && exportAs !== symbol) {
          rename(
            programPath.scope,
            exportAs,
            programPath.scope.generateUid(exportAs),
          );
        }

        exportedIdentifiers.set(exportAs, symbol);
      } else if (symbol === null) {
        // TODO `meta.exportsIdentifier[exportSymbol]` should be exported
        let relativePath = relative(options.projectRoot, asset.filePath);
        throw getThrowableDiagnosticForNode(
          `${relativePath} couldn't be statically analyzed when importing '${exportSymbol}'`,
          entry.filePath,
          loc,
        );
      } else {
        let relativePath = relative(options.projectRoot, asset.filePath);
        throw getThrowableDiagnosticForNode(
          `${relativePath} does not export '${exportSymbol}'`,
          entry.filePath,
          loc,
        );
      }
    }
  }

  for (let asset of referencedAssets) {
    let exportsId = getName(asset, 'init');
    exportedIdentifiers.set(exportsId, exportsId);
  }

  let exported = new Set<Symbol>();

  programPath.traverse({
    Declaration(path) {
      if (path.isExportDeclaration() || path.parentPath.isExportDeclaration()) {
        return;
      }

      let {node} = path;

      let bindingIdentifiers = path.getBindingIdentifierPaths(false, true);
      let ids: Array<string> = Object.keys(bindingIdentifiers);
      if (ids.length === 0) {
        return;
      }
      ids.sort();

      let exportedIdentifiersFiltered = ([
        ...exportedIdentifiers.entries(),
      ]: Array<[Symbol, Symbol]>)
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
        // We don't update the references in `node` itself (e.g. init), because this statement
        // will never be removed and therefore the shaking doesn't need correct
        // information. All existing references in `node` are "dead" but will also never be removed.
        if (process.env.PARCEL_BUILD_ENV !== 'production') {
          verifyScopeState(programPath.scope);
        }
        let [decl] = path.replaceWith(t.exportNamedDeclaration(node, []));
        if (process.env.PARCEL_BUILD_ENV !== 'production') {
          programPath.scope.crawl();
        }

        for (let sym of exportedSymbols) {
          let id = nullthrows(exportedIdentifiers.get(sym));
          id = replacements.get(id) || id;
          nullthrows(path.scope.getBinding(id)).reference(decl);
          rename(path.scope, id, sym);
          replacements.set(id, sym);
          exported.add(sym);
        }

        // If the default export is part of the declaration, add it as well
        if (defaultExport != null) {
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
          binding?.reference(decl);
        }

        // If there is only a default export, export the entire declaration.
      } else if (
        ids.length === 1 &&
        defaultExport != null &&
        !isVariableDeclaration(node) &&
        !isImportDeclaration(node)
      ) {
        invariant(isFunctionDeclaration(node) || isClassDeclaration(node));
        let binding = nullthrows(
          path.scope.getBinding(nullthrows(node.id).name),
        );
        // We don't update the references in `node` itself (e.g. function body), because this statement
        // will never be removed and therefore the shaking doesn't need correct
        // information. All existing references in `node` are "dead" but will also never be removed.
        if (process.env.PARCEL_BUILD_ENV !== 'production') {
          verifyScopeState(programPath.scope);
        }
        let [decl] = path.replaceWith(t.exportDefaultDeclaration(node));
        if (process.env.PARCEL_BUILD_ENV !== 'production') {
          programPath.scope.crawl();
        }
        binding.path = decl.get<
          NodePath<FunctionDeclaration | ClassDeclaration>,
        >('declaration');
        binding.reference(decl);

        // Otherwise, add export statements after for each identifier.
      } else {
        if (defaultExport != null) {
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
          binding?.reference(decl.get<NodePath<Identifier>>('declaration'));
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
            path.scope
              .getBinding(sym)
              ?.reference(spec.get<NodePath<Identifier>>('local'));
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

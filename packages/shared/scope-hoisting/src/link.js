// @flow

import type {
  Asset,
  BundleGraph,
  NamedBundle,
  PluginOptions,
  Symbol,
  SourceLocation,
} from '@parcel/types';
import type {ExternalModule, ExternalBundle} from './types';
import type {
  ArrayExpression,
  Expression,
  ExpressionStatement,
  File,
  Node,
  FunctionDeclaration,
  Identifier,
  Statement,
  StringLiteral,
  VariableDeclaration,
} from '@babel/types';

import nullthrows from 'nullthrows';
import path from 'path';
import fs from 'fs';
import invariant from 'assert';
import {relative} from 'path';
import template from '@babel/template';
import * as t from '@babel/types';
import {md} from '@parcel/diagnostic';
import {
  isAssignmentExpression,
  isExpressionStatement,
  isIdentifier,
  isMemberExpression,
  isSequenceExpression,
  isStringLiteral,
} from '@babel/types';
import {traverse2, REMOVE, Scope} from '@parcel/babylon-walk';
import {convertBabelLoc} from '@parcel/babel-ast-utils';
import globals from 'globals';
import {
  assertString,
  getName,
  getHelpers,
  getIdentifier,
  getThrowableDiagnosticForNode,
  isEntry,
  isReferenced,
  needsPrelude,
  needsDefaultInterop,
  parse,
} from './utils';
import OutputFormats from './formats/index.js';

const THROW_TEMPLATE = template.statement<
  {|MODULE: StringLiteral|},
  ExpressionStatement,
>('$parcel$missingModule(MODULE);');
const REQUIRE_RESOLVE_CALL_TEMPLATE = template.expression<
  {|ID: StringLiteral|},
  Expression,
>('require.resolve(ID)');
const FAKE_INIT_TEMPLATE = template.statement<
  {|INIT: Identifier, EXPORTS: Identifier|},
  FunctionDeclaration,
>(`function INIT(){
  return EXPORTS;
}`);
const PARCEL_REQUIRE_TEMPLATE = template.statement<
  {|PARCEL_REQUIRE_NAME: Identifier|},
  VariableDeclaration,
>(`var parcelRequire = $parcel$global.PARCEL_REQUIRE_NAME`);
const PARCEL_REQUIRE_NAME_TEMPLATE = template.statement<
  {|PARCEL_REQUIRE_NAME: StringLiteral|},
  VariableDeclaration,
>(`var parcelRequireName = PARCEL_REQUIRE_NAME;`);

const BUILTINS = Object.keys(globals.builtin);
const GLOBALS_BY_CONTEXT = {
  browser: new Set([...BUILTINS, ...Object.keys(globals.browser)]),
  'web-worker': new Set([...BUILTINS, ...Object.keys(globals.worker)]),
  'service-worker': new Set([
    ...BUILTINS,
    ...Object.keys(globals.serviceworker),
  ]),
  node: new Set([...BUILTINS, ...Object.keys(globals.node)]),
  'electron-main': new Set([...BUILTINS, ...Object.keys(globals.node)]),
  'electron-renderer': new Set([
    ...BUILTINS,
    ...Object.keys(globals.node),
    ...Object.keys(globals.browser),
  ]),
};

const PRELUDE_PATH = path.join(__dirname, 'prelude.js');
const PRELUDE = parse(
  fs.readFileSync(path.join(__dirname, 'prelude.js'), 'utf8'),
  PRELUDE_PATH,
);
const REGISTER_TEMPLATE = template.statements<
  {|
    REFERENCED_IDS: ArrayExpression,
    STATEMENTS: Array<Statement>,
    PARCEL_REQUIRE: Identifier,
  |},
  Array<Statement>,
>(`function $parcel$bundleWrapper() {
  if ($parcel$bundleWrapper._executed) return;
  $parcel$bundleWrapper._executed = true;
  STATEMENTS;
}
var $parcel$referencedAssets = REFERENCED_IDS;
for (var $parcel$i = 0; $parcel$i < $parcel$referencedAssets.length; $parcel$i++) {
  PARCEL_REQUIRE.registerBundle($parcel$referencedAssets[$parcel$i], $parcel$bundleWrapper);
}
`);
const WRAPPER_TEMPLATE = template.statement<
  {|STATEMENTS: Array<Statement>|},
  Statement,
>('(function () { STATEMENTS; })()');

export function link({
  bundle,
  bundleGraph,
  ast,
  options,
  wrappedAssets,
  parcelRequireName,
}: {|
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
  ast: File,
  options: PluginOptions,
  wrappedAssets: Set<string>,
  parcelRequireName: string,
|}): File {
  let format = OutputFormats[bundle.env.outputFormat];
  let replacements: Map<Symbol, Symbol> = new Map();
  let imports: Map<Symbol, null | [Asset, Symbol, ?SourceLocation]> = new Map();
  let exports: Map<Symbol, [Asset, Symbol]> = new Map();
  let assets: Map<string, Asset> = new Map();
  let exportsMap: Map<Symbol, Asset> = new Map();
  let scope = new Scope('program');
  let globalNames = GLOBALS_BY_CONTEXT[bundle.env.context];

  let helpers = getHelpers();

  let importedFiles = new Map<string, ExternalModule | ExternalBundle>();
  let referencedAssets = new Set();
  let reexports = new Set();

  // If building a library, the target is actually another bundler rather
  // than the final output that could be loaded in a browser. So, loader
  // runtimes are excluded, and instead we add imports into the entry bundle
  // of each bundle group pointing at the sibling bundles. These can be
  // picked up by another bundler later at which point runtimes will be added.
  if (bundle.env.isLibrary) {
    let bundles = bundleGraph.getReferencedBundles(bundle);
    for (let b of bundles) {
      importedFiles.set(nullthrows(b.filePath), {
        bundle: b,
        assets: new Set(),
      });
    }
  }

  // Build a mapping of all imported identifiers to replace.
  bundle.traverseAssets(asset => {
    assets.set(assertString(asset.meta.id), asset);
    exportsMap.set(assertString(asset.meta.exportsIdentifier), asset);

    for (let dep of bundleGraph.getDependencies(asset)) {
      let resolved = bundleGraph.getDependencyResolution(dep, bundle);
      let skipped = bundleGraph.isDependencySkipped(dep);

      // If the dependency was skipped, the `...$import$..` identifier needs to be removed.
      // If the dependency was excluded, it will be replaced by the output format at the very end.
      if (resolved || skipped) {
        for (let [imported, {local, loc}] of dep.symbols) {
          imports.set(
            local,
            resolved && !skipped ? [resolved, imported, loc] : null,
          );
        }
      }
    }

    for (let [symbol, {local}] of asset.symbols) {
      exports.set(local, [asset, symbol]);
    }

    if (bundleGraph.isAssetReferencedByDependant(bundle, asset)) {
      referencedAssets.add(asset);
    }
  });

  let entry = bundle.getMainEntry();
  let exportedSymbols: Map<
    string,
    Array<{|exportAs: string, local: string|}>,
  > = new Map();
  if (entry) {
    if (entry.meta.isCommonJS) {
      if (bundle.env.outputFormat === 'commonjs') {
        exportedSymbols.set(assertString(entry.meta.exportsIdentifier), [
          {exportAs: '*', local: 'exports'},
        ]);
      }
    } else {
      for (let {
        exportAs,
        exportSymbol,
        symbol,
        asset,
        loc,
      } of bundleGraph.getExportedSymbols(entry)) {
        if (typeof symbol === 'string') {
          let symbols = exportedSymbols.get(
            symbol === '*'
              ? assertString(entry.meta.exportsIdentifier)
              : symbol,
          );

          let local = exportAs;
          if (symbols) {
            local = symbols[0].local;
          } else {
            symbols = [];
            exportedSymbols.set(symbol, symbols);

            if (local === '*') {
              local = 'exports';
            } else if (!t.isValidIdentifier(local) || globalNames.has(local)) {
              local = scope.generateUid(local);
            } else {
              scope.add(local);
            }
          }

          symbols.push({exportAs, local});
        } else if (symbol === null) {
          // TODO `meta.exportsIdentifier[exportSymbol]` should be exported
          let relativePath = relative(options.projectRoot, asset.filePath);
          throw getThrowableDiagnosticForNode(
            md`${relativePath} couldn't be statically analyzed when importing '${exportSymbol}'`,
            entry.filePath,
            loc,
          );
        } else if (symbol !== false) {
          let relativePath = relative(options.projectRoot, asset.filePath);
          throw getThrowableDiagnosticForNode(
            md`${relativePath} does not export '${exportSymbol}'`,
            entry.filePath,
            loc,
          );
        }
      }
    }
  }

  let resolveSymbolCache = new Map();

  function resolveSymbol(inputAsset, inputSymbol: Symbol, bundle) {
    let k = inputAsset.id + ':' + inputSymbol + ':' + bundle.id;
    let cached = resolveSymbolCache.get(k);
    if (cached) {
      return cached;
    }

    let {asset, exportSymbol, symbol, loc} = bundleGraph.resolveSymbol(
      inputAsset,
      inputSymbol,
      bundle,
    );
    if (asset.meta.staticExports === false) {
      let res = {
        asset: asset,
        symbol: exportSymbol,
        identifier: null,
        loc,
      };

      resolveSymbolCache.set(k, res);
      return res;
    }

    let identifier = symbol;

    if (identifier && imports.get(identifier) === null) {
      // a deferred import
      let res = {
        asset: asset,
        symbol: exportSymbol,
        identifier: null,
        loc,
      };

      resolveSymbolCache.set(k, res);
      return res;
    }

    // If this is a wildcard import, resolve to the exports object.
    if (asset && exportSymbol === '*') {
      identifier = assertString(asset.meta.exportsIdentifier);
    }

    if (identifier && replacements.has(identifier)) {
      identifier = replacements.get(identifier);
    }

    let res = {asset: asset, symbol: exportSymbol, identifier, loc};
    resolveSymbolCache.set(k, res);
    return res;
  }

  let needsExportsIdentifierCache = new Map();
  let bundleNeedsMainExportsIdentifier =
    (bundle.env.outputFormat === 'global' &&
      (!isEntry(bundle, bundleGraph) || isReferenced(bundle, bundleGraph))) ||
    (bundle.env.outputFormat === 'esmodule' && entry?.meta.isCommonJS);

  function needsExportsIdentifier(name: string) {
    let asset = exportsMap.get(name);
    if (asset) {
      return needsExportsIdentifierForAsset(asset);
    }

    return true;
  }

  function needsExportsIdentifierForAsset(asset: Asset) {
    if (needsExportsIdentifierCache.has(asset)) {
      return needsExportsIdentifierCache.get(asset);
    }

    if (
      asset.meta.staticExports === false ||
      wrappedAssets.has(asset.id) ||
      referencedAssets.has(asset)
    ) {
      needsExportsIdentifierCache.set(asset, true);
      return true;
    }

    let isEntry = asset === bundle.getMainEntry();
    if (isEntry && bundleNeedsMainExportsIdentifier) {
      needsExportsIdentifierCache.set(asset, true);
      return true;
    }

    let deps = bundleGraph.getIncomingDependencies(asset);
    let usedSymbols = bundleGraph.getUsedSymbols(asset);
    if (usedSymbols.has('*') && (!isEntry || asset.meta.isCommonJS)) {
      needsExportsIdentifierCache.set(asset, true);
      return true;
    }

    let res = deps.some(
      dep =>
        // Internalized async dependencies need the exports object for Promise.resolve($id$exports)
        (dep.isAsync && bundle.hasDependency(dep)) ||
        // If there's a dependency on the namespace, and the parent asset's exports object is used,
        // we need to keep the exports object for $parcel$exportWildcard.
        (!isEntry &&
          dep.symbols.hasExportSymbol('*') &&
          needsExportsIdentifierForAsset(
            nullthrows(bundleGraph.getAssetWithDependency(dep)),
          )) ||
        // If the asset is CommonJS and there's an ES6 dependency on `default`, we need the
        // exports identifier to call $parcel$interopDefault.
        (asset.meta.isCommonJS &&
          dep.meta.isES6Module &&
          dep.symbols.hasExportSymbol('default')) ||
        // If the asset is an ES6 module with a default export, and there's a CommonJS dependency
        // on it, we need the exports identifier to call $parcel$defineInteropFlag.
        (asset.meta.isES6Module &&
          asset.symbols.hasExportSymbol('default') &&
          dep.meta.isCommonJS &&
          !dep.isAsync &&
          dep.symbols.hasExportSymbol('*')) ||
        // If one of the symbols imported by the dependency doesn't resolve, then we need the
        // exports identifier to fall back to.
        [...dep.symbols].some(
          ([symbol]) => !resolveSymbol(asset, symbol, bundle).identifier,
        ),
    );

    needsExportsIdentifierCache.set(asset, res);
    return res;
  }

  function needsDeclaration(name: string) {
    let exp = exports.get(name);
    if (exp) {
      let [asset, local] = exp;
      if (asset === bundle.getMainEntry() && bundle.env.isLibrary) {
        return true;
      }

      if (asset.meta.staticExports === false) {
        return true;
      }

      let usedSymbols = bundleGraph.getUsedSymbols(asset);

      // If the asset is CommonJS, and "default" was used but not defined, this
      // will resolve to the $id$exports object, so we need to retain all symbols.
      if (
        asset.meta.isCommonJS &&
        usedSymbols.has('default') &&
        !asset.symbols.hasExportSymbol('default')
      ) {
        return true;
      }

      // Otherwise, if the symbol is pure and unused, it is safe to remove.
      if (asset.symbols.get(local)?.meta?.isPure) {
        return usedSymbols.has(local) || usedSymbols.has('*');
      }
    }

    return true;
  }

  function maybeReplaceIdentifier(node: Identifier) {
    let {name} = node;
    if (typeof name !== 'string') {
      return;
    }

    let replacement = replacements.get(name);
    if (replacement) {
      node.name = replacement;
    }

    if (imports.has(name)) {
      let res: ?Node;
      let imported = imports.get(name);
      if (imported == null) {
        // import was deferred
        res = t.objectExpression([]);
      } else {
        let [asset, symbol] = imported;
        res = replaceImportNode(asset, symbol, node);

        // If the export does not exist, replace with an empty object.
        if (!res) {
          res = t.objectExpression([]);
        }
      }
      return res;
    }
  }

  // node is an Identifier like $id$import$foo that directly imports originalName from originalModule
  function replaceImportNode(originalModule, originalName, node) {
    let {asset: mod, symbol, identifier} = resolveSymbol(
      originalModule,
      originalName,
      bundle,
    );

    // If the symbol resolves to the original module where the export is defined,
    // do not perform any replacements.
    let exp = exports.get(node.name);
    if (exp && exp[0] === mod) {
      return node;
    }

    let res = identifier != null ? findSymbol(node, identifier) : identifier;
    if (mod.meta.staticExports === false || wrappedAssets.has(mod.id)) {
      res = null;
    }

    // If the module is not in this bundle, create a `require` call for it.
    if (!mod.meta.id || !assets.has(assertString(mod.meta.id))) {
      if (res === false) {
        // Asset was skipped
        return null;
      }

      res = addBundleImport(mod, node);
      return res ? interop(mod, symbol, node, res) : null;
    }

    // The ESM 'does not export' case was already handled by core's symbol proapgation.

    // Look for an exports object if we bailed out.
    // TODO remove the first part of the condition once bundleGraph.resolveSymbol().identifier === null covers this
    if ((res === undefined && mod.meta.isCommonJS) || res === null) {
      if (wrappedAssets.has(mod.id)) {
        res = t.callExpression(getIdentifier(mod, 'init'), []);
      } else {
        res = findSymbol(node, assertString(mod.meta.exportsIdentifier));
        if (!node) {
          return null;
        }
      }

      res = interop(mod, symbol, res, res);
      return res;
    }

    return res;
  }

  function findSymbol(node, symbol) {
    if (symbol && replacements.has(symbol)) {
      symbol = replacements.get(symbol);
    }

    let exp = symbol && exportedSymbols.get(symbol);
    if (exp) {
      symbol = exp[0].local;
    }

    // if the symbol exists there is no need to remap it
    if (symbol) {
      return t.identifier(symbol);
    }

    return null;
  }

  function interop(mod, originalName, originalNode, node) {
    // Handle interop for default imports of CommonJS modules.
    if (
      mod.meta.isCommonJS &&
      originalName === 'default' &&
      needsDefaultInterop(bundleGraph, bundle, mod)
    ) {
      let name = getName(mod, '$interop$default');
      return t.identifier(name);
    }

    // if there is a CommonJS export return $id$exports.name
    if (originalName !== '*' && node != null) {
      if (t.isValidIdentifier(originalName, false)) {
        return t.memberExpression(node, t.identifier(originalName));
      } else {
        return t.memberExpression(node, t.stringLiteral(originalName), true);
      }
    }

    return node;
  }

  function addExternalModule(node, ancestors, dep) {
    // Find an existing import for this specifier, or create a new one.
    let importedFile = importedFiles.get(dep.moduleSpecifier);
    if (!importedFile) {
      importedFile = {
        source: dep.moduleSpecifier,
        specifiers: new Map(),
        isCommonJS: !!dep.meta?.isCommonJS,
        loc: convertBabelLoc(node.loc),
      };

      importedFiles.set(dep.moduleSpecifier, importedFile);
    }

    invariant(importedFile.specifiers != null);
    let specifiers = importedFile.specifiers;

    // For each of the imported symbols, add to the list of imported specifiers.
    for (let [imported, {local}] of dep.symbols) {
      // If already imported, just add the already renamed variable to the mapping.
      let renamed = specifiers.get(imported);
      if (renamed) {
        replacements.set(local, renamed);
        continue;
      }

      renamed = replacements.get(local);

      // If this symbol is re-exported, add it to the reexport list.
      let exp = exportedSymbols.get(local);
      if (exp) {
        renamed = exp[0].local;
        for (let e of exp) {
          reexports.add(e);
        }
      }

      if (!renamed) {
        // Rename the specifier to something nicer. Try to use the imported
        // name, except for default and namespace imports, and if the name is
        // already in scope.
        renamed = imported;
        if (imported === 'default' || imported === '*') {
          renamed = scope.generateUid(dep.moduleSpecifier);
        } else if (scope.has(imported)) {
          renamed = scope.generateUid(imported);
        } else {
          scope.add(imported);
        }

        replacements.set(local, renamed);
      }

      specifiers.set(imported, renamed);
    }

    return specifiers.get('*');
  }

  function addBundleImport(mod, node) {
    // Find a bundle that's reachable from the current bundle (sibling or ancestor)
    // containing this asset, and create an import for it if needed.
    let importedBundle = bundleGraph.findReachableBundleWithAsset(bundle, mod);
    if (!importedBundle) {
      throw new Error(
        `No reachable bundle found containing ${relative(
          options.inputFS.cwd(),
          mod.filePath,
        )}`,
      );
    }

    let filePath = nullthrows(importedBundle.filePath);
    let imported = importedFiles.get(filePath);
    if (!imported) {
      imported = {
        bundle: importedBundle,
        assets: new Set(),
        loc: convertBabelLoc(node.loc),
      };
      importedFiles.set(filePath, imported);
    }

    invariant(imported.assets != null);
    imported.assets.add(mod);

    let initIdentifier = getIdentifier(mod, 'init');
    return t.callExpression(initIdentifier, []);
  }

  traverse2(ast, {
    CallExpression(node, state, ancestors) {
      let {arguments: args, callee} = node;
      if (!isIdentifier(callee)) {
        return;
      }

      // each require('module') call gets replaced with $parcel$require(id, 'module')
      if (callee.name === '$parcel$require') {
        let [id, source] = args;
        if (
          args.length < 2 ||
          !isStringLiteral(id) ||
          !isStringLiteral(source)
        ) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$require(number, string)',
          );
        }

        let asset = nullthrows(assets.get(id.value));
        let dep = nullthrows(
          bundleGraph
            .getDependencies(asset)
            .find(dep => dep.moduleSpecifier === source.value),
        );

        let asyncResolution = bundleGraph.resolveAsyncDependency(dep, bundle);
        let mod =
          asyncResolution?.type === 'asset'
            ? // Prefer the underlying asset over a runtime to load it. It will
              // be wrapped in Promise.resolve() later.
              asyncResolution.value
            : bundleGraph.getDependencyResolution(dep, bundle);
        let newNode;

        if (!bundleGraph.isDependencySkipped(dep)) {
          if (!mod) {
            if (dep.isOptional) {
              newNode = THROW_TEMPLATE({MODULE: t.stringLiteral(source.value)});
              scope.add('$parcel$missingModule');
            } else {
              let name = addExternalModule(node, ancestors, dep);
              if (!isUnusedValue(ancestors) && name) {
                newNode = t.identifier(name);
              }
            }
          } else {
            // If there is a third arg, it is an identifier to replace the require with.
            // This happens when `require('foo').bar` is detected in the hoister.
            if (args.length > 2 && isIdentifier(args[2])) {
              newNode = maybeReplaceIdentifier(args[2]);
            } else {
              if (mod.meta.id && assets.has(assertString(mod.meta.id))) {
                let isValueUsed = !isUnusedValue(ancestors);

                // We need to wrap the module in a function when a require
                // call happens inside a non top-level scope, e.g. in a
                // function, if statement, or conditional expression.
                if (wrappedAssets.has(mod.id)) {
                  newNode = t.callExpression(getIdentifier(mod, 'init'), []);
                }
                // Replace with nothing if the require call's result is not used.
                else if (isValueUsed) {
                  newNode = t.identifier(
                    assertString(mod.meta.exportsIdentifier),
                  );
                }
              } else if (mod.type === 'js') {
                newNode = addBundleImport(mod, node);
              }
            }

            // async dependency that was internalized
            if (
              newNode &&
              asyncResolution?.type === 'asset' &&
              !isExpressionStatement(newNode)
            ) {
              let _newNode = newNode; // For Flow
              newNode = t.callExpression(
                t.memberExpression(
                  t.identifier('Promise'),
                  t.identifier('resolve'),
                ),
                [_newNode],
              );
            }
          }
        }

        if (newNode) {
          return newNode;
        } else {
          if (isUnusedValue(ancestors)) {
            return REMOVE;
          } else {
            // e.g. $parcel$exportWildcard;
            return t.objectExpression([]);
          }
        }
      } else if (callee.name === '$parcel$require$resolve') {
        let [id, source] = args;
        if (
          args.length !== 2 ||
          !isStringLiteral(id) ||
          !isStringLiteral(source)
        ) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$require$resolve(number, string)',
          );
        }

        let mapped = nullthrows(assets.get(id.value));
        let dep = nullthrows(
          bundleGraph
            .getDependencies(mapped)
            .find(dep => dep.moduleSpecifier === source.value),
        );
        if (!bundleGraph.getDependencyResolution(dep, bundle)) {
          // was excluded from bundling (e.g. includeNodeModules = false)
          if (bundle.env.outputFormat !== 'commonjs') {
            throw getThrowableDiagnosticForNode(
              "'require.resolve' calls for excluded assets are only supported with outputFormat: 'commonjs'",
              mapped.filePath,
              convertBabelLoc(node.loc),
            );
          }

          return REQUIRE_RESOLVE_CALL_TEMPLATE({
            ID: t.stringLiteral(source.value),
          });
        } else {
          throw getThrowableDiagnosticForNode(
            "'require.resolve' calls for bundled modules or bundled assets aren't supported with scope hoisting",
            mapped.filePath,
            convertBabelLoc(node.loc),
          );
        }
      } else if (callee.name === '$parcel$exportWildcard') {
        if (args.length !== 2 || !isIdentifier(args[0])) {
          throw new Error('Invalid call to $parcel$exportWildcard');
        }

        if (!needsExportsIdentifier(args[0].name)) {
          return REMOVE;
        }
      } else if (callee.name === '$parcel$export') {
        let [obj, symbol] = args;
        invariant(isIdentifier(obj));
        invariant(isStringLiteral(symbol));
        let objName = obj.name;
        let symbolName = symbol.value;

        // Remove if the $id$exports object is unused.
        if (!needsExportsIdentifier(objName)) {
          return REMOVE;
        }

        if (objName === 'exports') {
          // Assignment inside a wrapped asset
          return;
        }

        let asset = nullthrows(exportsMap.get(objName));
        let incomingDeps = bundleGraph.getIncomingDependencies(asset);
        let unused = incomingDeps.every(d => {
          let symbols = bundleGraph.getUsedSymbols(d);
          return !symbols.has(symbolName) && !symbols.has('*');
        });
        if (unused) {
          return REMOVE;
        }
      }
    },
    VariableDeclarator: {
      exit(node) {
        let {id} = node;

        if (isIdentifier(id)) {
          if (!needsExportsIdentifier(id.name)) {
            return REMOVE;
          }

          if (!needsDeclaration(id.name)) {
            return REMOVE;
          }
        }
      },
    },
    VariableDeclaration: {
      exit(node) {
        if (node.declarations.length === 0) {
          return REMOVE;
        }

        // Handle exported declarations using output format specific logic.
        let exported = [];
        for (let decl of node.declarations) {
          let bindingIdentifiers = t.getBindingIdentifiers(decl.id);
          for (let name in bindingIdentifiers) {
            let exp = exportedSymbols.get(name);
            if (exp) {
              bindingIdentifiers[name].name = exp[0].local;
              exported.push(...exp);
            }
          }
        }

        if (exported.length > 0) {
          return format.generateMainExport(node, exported);
        }
      },
    },
    Declaration: {
      exit(node) {
        if (t.isVariableDeclaration(node)) {
          return;
        }

        if (node.id != null && isIdentifier(node.id)) {
          let id = node.id;
          if (!needsDeclaration(id.name)) {
            return REMOVE;
          }

          // Handle exported declarations using output format specific logic.
          let exp = exportedSymbols.get(id.name);
          if (exp) {
            id.name = exp[0].local;
            return format.generateMainExport(node, exp);
          }
        }
      },
    },
    AssignmentExpression(node) {
      let {left, right} = node;

      if (isMemberExpression(left)) {
        let {object, property, computed} = left;
        if (
          !(
            isIdentifier(object) &&
            ((isIdentifier(property) && !computed) || isStringLiteral(property))
          )
        ) {
          return;
        }

        // Rename references to exported symbols to the exported name.
        let exp = exportedSymbols.get(object.name);
        if (exp) {
          object.name = exp[0].local;
        }

        let asset = exportsMap.get(object.name);
        if (!asset) {
          return;
        }

        if (!needsExportsIdentifier(object.name)) {
          return REMOVE;
        }

        if (isIdentifier(right) && !needsDeclaration(right.name)) {
          return REMOVE;
        }
      }
      if (isIdentifier(node.left)) {
        let res = maybeReplaceIdentifier(node.left);
        if (isIdentifier(res) || isMemberExpression(res)) {
          node.left = res;
        }

        // remove unused CommonJS `$id$export$foo = $id$var$foo;`
        if (isIdentifier(left) && !needsDeclaration(left.name)) {
          return REMOVE;
        }
      }
    },
    Identifier(node, state, ancestors) {
      if (
        t.isReferenced(
          node,
          ancestors[ancestors.length - 2],
          ancestors[ancestors.length - 3],
        )
      ) {
        // If referencing a helper, add it to the scope.
        if (helpers.has(node.name)) {
          scope.add(node.name);
          return;
        }

        // Rename references to exported symbols to the exported name.
        let exp = exportedSymbols.get(node.name);
        if (exp) {
          node.name = exp[0].local;
        }

        return maybeReplaceIdentifier(node);
      }
    },
    ExpressionStatement: {
      exit(node) {
        // Handle exported declarations using output format specific logic.
        if (
          isAssignmentExpression(node.expression) &&
          isIdentifier(node.expression.left)
        ) {
          let left = node.expression.left;
          let exp = exportedSymbols.get(left.name);
          if (exp) {
            left.name = exp[0].local;
            return format.generateMainExport(node, exp);
          }
        }
      },
    },
    SequenceExpression: {
      exit(node) {
        // This can happen if a $parcel$require result is unused.
        if (node.expressions.length === 1) {
          return node.expressions[0];
        }
      },
    },
    Program: {
      exit(node) {
        let statements: Array<Statement> = node.body;

        let hoistedImports = [];
        for (let file of importedFiles.values()) {
          if (file.bundle) {
            let {hoisted, imports} = format.generateBundleImports(
              bundleGraph,
              bundle,
              file,
              scope,
            );
            statements = imports.concat(statements);
            hoistedImports = hoistedImports.concat(hoisted);
          } else {
            let res = format.generateExternalImport(bundle, file, scope);
            statements = res.concat(statements);
          }
        }

        if (referencedAssets.size > 0) {
          // Insert fake init functions that will be imported in other bundles,
          // because `asset.meta.shouldWrap` isn't set in a packager if `asset` is
          // not in the current bundle.
          statements = statements.concat(
            ([...referencedAssets]: Array<Asset>)
              .filter(a => !wrappedAssets.has(a.id))
              .map(a => {
                return FAKE_INIT_TEMPLATE({
                  INIT: getIdentifier(a, 'init'),
                  EXPORTS: t.identifier(assertString(a.meta.exportsIdentifier)),
                });
              }),
          );
        }

        // Generate exports
        let exported = format.generateBundleExports(
          bundleGraph,
          bundle,
          referencedAssets,
          scope,
          reexports,
        );

        statements = statements.concat(exported);

        // If the prelude is needed, ensure parcelRequire is available.
        if (
          !scope.names.has('parcelRequire') &&
          needsPrelude(bundle, bundleGraph)
        ) {
          scope.add('parcelRequire');
        }

        if (bundle.env.outputFormat === 'global') {
          // Wrap async bundles in a closure and register with parcelRequire so they are executed
          // at the right time (after other bundle dependencies are loaded).
          let isAsync = !isEntry(bundle, bundleGraph);
          if (isAsync) {
            statements = REGISTER_TEMPLATE({
              STATEMENTS: statements,
              REFERENCED_IDS: t.arrayExpression(
                [bundle.getMainEntry(), ...referencedAssets]
                  .filter(Boolean)
                  .map(asset =>
                    t.stringLiteral(bundleGraph.getAssetPublicId(asset)),
                  ),
              ),
              PARCEL_REQUIRE: t.identifier(parcelRequireName),
            });
          }

          if (needsPrelude(bundle, bundleGraph)) {
            scope.add('$parcel$global');
            statements = [
              PARCEL_REQUIRE_NAME_TEMPLATE({
                PARCEL_REQUIRE_NAME: t.stringLiteral(parcelRequireName),
              }),
            ]
              .concat(PRELUDE)
              .concat(statements);
          }
        }

        let usedHelpers: Array<Statement> = [];
        for (let [name, helper] of helpers) {
          if (scope.names.has(name)) {
            usedHelpers.push(helper);
          }
        }
        if (scope.names.has('parcelRequire')) {
          usedHelpers.push(
            PARCEL_REQUIRE_TEMPLATE({
              PARCEL_REQUIRE_NAME: t.identifier(parcelRequireName),
            }),
          );
        }

        statements = hoistedImports.concat(usedHelpers).concat(statements);

        if (bundle.env.outputFormat === 'global') {
          statements = [WRAPPER_TEMPLATE({STATEMENTS: statements})];
        }

        // $FlowFixMe
        return t.program(statements);
      },
    },
  });

  return ast;
}

function isUnusedValue(ancestors, i = 1) {
  let node = ancestors[ancestors.length - i];
  let parent = ancestors[ancestors.length - i - 1];
  return (
    isExpressionStatement(parent) ||
    (isSequenceExpression(parent) &&
      (node !== parent.expressions[parent.expressions.length - 1] ||
        isUnusedValue(ancestors, i + 1)))
  );
}

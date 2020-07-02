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
  Expression,
  File,
  FunctionDeclaration,
  Identifier,
  Statement,
  StringLiteral,
} from '@babel/types';

import nullthrows from 'nullthrows';
import invariant from 'assert';
import {relative} from 'path';
import template from '@babel/template';
import * as _t from '@babel/types';
let t = {..._t};
import {
  isAssignmentExpression,
  isExpressionStatement,
  isIdentifier,
  isMemberExpression,
  isObjectPattern,
  isObjectProperty,
  isSequenceExpression,
  isStringLiteral,
} from '@babel/types';
import {traverse, REMOVE} from '@parcel/babylon-walk';
import {
  assertString,
  convertBabelLoc,
  getName,
  getHelpers,
  getIdentifier,
  getThrowableDiagnosticForNode,
  isEntry,
  isReferenced,
} from './utils';
import {Scope} from './scope';
import OutputFormats from './formats/index.js';

const THROW_TEMPLATE = template.statement<{|MODULE: StringLiteral|}, Statement>(
  '$parcel$missingModule(MODULE);',
);
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

const bundleCache = new Map();

export function link({
  bundle,
  bundleGraph,
  asset,
  ast,
  options,
  wrappedAssets,
}: {|
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
  ast: File,
  options: PluginOptions,
  wrappedAssets: Set<string>,
|}): {|ast: File, referencedAssets: Set<Asset>|} {
  let format = OutputFormats[bundle.env.outputFormat];
  let replacements: Map<Symbol, Symbol> = new Map();
  let imports: Map<Symbol, null | [Asset, Symbol, ?SourceLocation]> = new Map();
  let exports: Map<Symbol, [Asset, Symbol]> = new Map();
  let assets: Map<string, Asset> = new Map();
  let exportsMap: Map<Symbol, Asset> = new Map();
  let scope = new Scope();
  let dependencyMap = new Map();

  let helpers = getHelpers();

  let importedFiles = new Map<string, ExternalModule | ExternalBundle>();
  let referencedAssets = new Set();
  let reexports = new Set();
  let bundleNeedsMainExportsIdentifier = false;

  // If building a library, the target is actually another bundler rather
  // than the final output that could be loaded in a browser. So, loader
  // runtimes are excluded, and instead we add imports into the entry bundle
  // of each bundle group pointing at the sibling bundles. These can be
  // picked up by another bundler later at which point runtimes will be added.
  if (bundle.env.isLibrary) {
    let bundles = bundleGraph.getSiblingBundles(bundle);
    for (let b of bundles) {
      importedFiles.set(nullthrows(b.filePath), {
        bundle: b,
        assets: new Set(),
      });
    }
  }

  let cached = bundleCache.get(bundle);
  if (cached) {
    assets = cached.assets;
    exportsMap = cached.exportsMap;
    dependencyMap = cached.dependencyMap;
    referencedAssets = cached.referencedAssets;
    bundleNeedsMainExportsIdentifier = cached.bundleNeedsMainExportsIdentifier;
  } else {
    // Build a mapping of all imported identifiers to replace.
    bundle.traverseAssets(asset => {
      assets.set(assertString(asset.meta.id), asset);
      exportsMap.set(assertString(asset.meta.exportsIdentifier), asset);

      for (let dep of bundleGraph.getDependencies(asset)) {
        dependencyMap.set(dep.id, dep);
        let resolved = bundleGraph.getDependencyResolution(dep, bundle);

        // If the dependency was deferred, the `...$import$..` identifier needs to be removed.
        // If the dependency was excluded, it will be replaced by the output format at the very end.
        if (resolved || bundleGraph.isDependencyDeferred(dep)) {
          for (let [imported, {local, loc}] of dep.symbols) {
            imports.set(local, resolved ? [resolved, imported, loc] : null);
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

    bundleNeedsMainExportsIdentifier =
      bundle.env.outputFormat === 'global' &&
      (!isEntry(bundle, bundleGraph) || isReferenced(bundle, bundleGraph));

    bundleCache.set(bundle, {
      assets,
      exportsMap,
      dependencyMap,
      referencedAssets,
      bundleNeedsMainExportsIdentifier,
    });
  }

  let entry = bundle.getMainEntry();
  let exportedSymbols: Map<
    string,
    Array<{|exportAs: string, local: string|}>,
  > = new Map();
  if (entry && entry === asset) {
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
        if (symbol != null) {
          let symbols = exportedSymbols.get(symbol);
          let local = exportAs;
          if (symbols) {
            local = symbols[0].local;
          } else {
            symbols = [];
            exportedSymbols.set(symbol, symbols);

            if (!t.isValidIdentifier(local)) {
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
    if (asset.meta.resolveExportsBailedOut) {
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

    if (replacements && identifier && replacements.has(identifier)) {
      identifier = replacements.get(identifier);
    }

    let res = {asset: asset, symbol: exportSymbol, identifier, loc};
    resolveSymbolCache.set(k, res);
    return res;
  }

  let needsExportsIdentifierCache = new Map();

  function needsExportsIdentifier(name: string) {
    let asset = exportsMap.get(name);
    if (needsExportsIdentifierCache.has(asset)) {
      return needsExportsIdentifierCache.get(asset);
    }

    if (
      !asset ||
      asset.meta.pureExports === false ||
      wrappedAssets.has(asset.id)
    ) {
      needsExportsIdentifierCache.set(asset, true);
      return true;
    }

    if (
      asset === bundle.getMainEntry() &&
      (asset.meta.isCommonJS || bundleNeedsMainExportsIdentifier)
    ) {
      needsExportsIdentifierCache.set(asset, true);
      return true;
    }

    let deps = bundleGraph.getIncomingDependencies(asset);
    let res = deps.some(
      dep =>
        // If there's a dependency on the namespace, we need to keep the exports object.
        // TODO: check used symbols on asset instead once symbol propagation lands.
        dep.symbols.hasExportSymbol('*') ||
        // If there's a dependency in another bundle, we need to expose the whole exports object.
        (!bundle.hasDependency(dep) && dep.sourcePath != null) ||
        // If the asset is CommonJS and there's a dependency on `default`, we need the
        // exports identifier to call $parcel$interopDefault.
        (asset.meta.isCommonJS && dep.symbols.hasExportSymbol('default')) ||
        // If the asset is an ES6 module with a default export, and there's a CommonJS dependency
        // on it, we need the exports identifier to call $parcel$defineInteropFlag.
        (asset.meta.isES6Module &&
          asset.symbols.hasExportSymbol('default') &&
          dep.meta.isCommonJS) ||
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
      if (needsExportsIdentifier(assertString(asset.meta.exportsIdentifier))) {
        return true;
      }

      if (asset === bundle.getMainEntry() && bundle.env.isLibrary) {
        return true;
      }

      if (asset.symbols.get(local)?.meta?.isPure) {
        let deps = bundleGraph.getIncomingDependencies(asset);
        return deps.some(dep => dep.symbols.hasExportSymbol(local));
      }
    }

    return true;
  }

  function maybeReplaceIdentifier(node: Identifier, ancestors) {
    let {name} = node;
    if (typeof name !== 'string') {
      return;
    }

    let replacement = replacements.get(name);
    if (replacement) {
      node.name = replacement;
    }

    if (imports.has(name)) {
      let res: ?BabelNode;
      let imported = imports.get(name);
      if (imported == null) {
        // import was deferred
        res = t.objectExpression([]);
      } else {
        let [asset, symbol, loc] = imported;
        res = replaceImportNode(asset, symbol, node, ancestors, loc);

        // If the export does not exist, replace with an empty object.
        if (!res) {
          res = t.objectExpression([]);
        }
      }
      return res;
    }
  }

  // node is an Identifier like $id$import$foo that directly imports originalName from originalModule
  function replaceImportNode(
    originalModule,
    originalName,
    node,
    ancestors,
    depLoc,
  ) {
    let {asset: mod, symbol, identifier} = resolveSymbol(
      originalModule,
      originalName,
      bundle,
    );

    let res = identifier != null ? findSymbol(node, identifier) : identifier;

    // If the module is not in this bundle, create a `require` call for it.
    if (!mod.meta.id || !assets.has(assertString(mod.meta.id))) {
      res = addBundleImport(mod, node, ancestors);
      return res ? interop(mod, symbol, node, res) : null;
    }

    // If this is an ES6 module, throw an error if we cannot resolve the module
    if (res === undefined && !mod.meta.isCommonJS && mod.meta.isES6Module) {
      let relativePath = relative(options.projectRoot, mod.filePath);
      throw getThrowableDiagnosticForNode(
        `${relativePath} does not export '${symbol}'`,
        depLoc?.filePath ?? node.loc?.filename,
        depLoc,
      );
    }

    // Look for an exports object if we bailed out.
    // TODO remove the first part of the condition once bundleGraph.resolveSymbol().identifier === null covers this
    if ((res === undefined && mod.meta.isCommonJS) || res === null) {
      res = findSymbol(node, assertString(mod.meta.exportsIdentifier));
      if (!res) {
        return null;
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
    if (mod.meta.isCommonJS && originalName === 'default') {
      let name = getName(mod, '$interop$default');
      return t.identifier(name);
    }

    // if there is a CommonJS export return $id$exports.name
    if (originalName !== '*') {
      return t.memberExpression(node, t.identifier(originalName));
    }

    return node;
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

  function addExternalModule(node, ancestors, dep) {
    // Find an existing import for this specifier, or create a new one.
    let importedFile = importedFiles.get(dep.moduleSpecifier);
    if (!importedFile) {
      importedFile = {
        source: dep.moduleSpecifier,
        specifiers: new Map(),
        isCommonJS: !!dep.meta.isCommonJS,
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

  function addBundleImport(mod, node, ancestors) {
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

    // If not unused, add the asset to the list of specifiers to import.
    if (!isUnusedValue(ancestors) && mod.meta.exportsIdentifier) {
      invariant(imported.assets != null);
      imported.assets.add(mod);

      let initIdentifier = getIdentifier(mod, 'init');
      return t.callExpression(initIdentifier, []);
    }
  }

  let requiresInStatement = new Set();
  function generatePlaceholders(ancestors, node) {
    if (
      requiresInStatement.size === 0 ||
      !t.isProgram(ancestors[ancestors.length - 2])
    ) {
      if (node === REMOVE) {
        return REMOVE;
      }

      return;
    }

    let res = [];
    for (let id of requiresInStatement) {
      // res.push(t.expressionStatement(t.callExpression(t.identifier('$parcel$asset$placeholder'), [t.stringLiteral(id)])));
      res.push(
        t.expressionStatement(t.identifier('PARCEL_ASSET_PLACEHOLDER_' + id)),
      );
    }

    if (node !== REMOVE) {
      res.push(node);
    }

    requiresInStatement.clear();
    return res;
  }

  traverse(ast, {
    Statement: {
      enter(node, state, ancestors) {
        if (t.isProgram(ancestors[ancestors.length - 2])) {
          requiresInStatement.clear();
        }
      },
      exit(node, state, ancestors) {
        if (t.isProgram(ancestors[ancestors.length - 2])) {
          return generatePlaceholders(ancestors, node);
        }
      },
    },

    CallExpression(node, state, ancestors) {
      let {arguments: args, callee} = node;
      if (!isIdentifier(callee)) {
        return;
      }

      // each require('module') call gets replaced with $parcel$require(id, 'module')
      if (callee.name === '$parcel$require') {
        let [depId] = args;
        if (args.length !== 1 || !isStringLiteral(depId)) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$require(string)',
          );
        }

        let dep = nullthrows(dependencyMap.get(depId.value));

        let mod = bundleGraph.getDependencyResolution(dep, bundle);
        let newNode;

        if (!mod) {
          if (dep.isOptional) {
            return THROW_TEMPLATE({
              MODULE: t.stringLiteral(dep.moduleSpecifier),
            });
          } else if (dep.isWeak && bundleGraph.isDependencyDeferred(dep)) {
            return REMOVE;
          } else {
            let name = addExternalModule(node, ancestors, dep);
            if (isUnusedValue(ancestors) || !name) {
              return REMOVE;
            } else {
              return t.identifier(name);
            }
          }
        } else {
          if (mod.meta.id && assets.get(assertString(mod.meta.id))) {
            let name = assertString(mod.meta.exportsIdentifier);
            let isValueUsed = !isUnusedValue(ancestors);

            // We need to wrap the module in a function when a require
            // call happens inside a non top-level scope, e.g. in a
            // function, if statement, or conditional expression.
            if (wrappedAssets.has(mod.id)) {
              newNode = t.callExpression(getIdentifier(mod, 'init'), []);
            }
            // Replace with nothing if the require call's result is not used.
            else if (isValueUsed) {
              newNode = t.identifier(replacements.get(name) || name);
            }

            requiresInStatement.add(mod.id);
          } else if (mod.type === 'js') {
            newNode = addBundleImport(mod, node, ancestors);
          }

          if (newNode) {
            return newNode;
          } else {
            return REMOVE;
          }
        }
      } else if (callee.name === '$parcel$require$resolve') {
        let [assetId, depId] = args;
        if (
          args.length !== 2 ||
          !isStringLiteral(assetId) ||
          !isStringLiteral(depId)
        ) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$require$resolve(string, string)',
          );
        }

        let mapped = nullthrows(assets.get(assetId.value));
        let dep = nullthrows(dependencyMap.get(depId.value));
        if (!bundleGraph.getDependencyResolution(dep, bundle)) {
          // was excluded from bundling (e.g. includeNodeModules = false)
          if (bundle.env.outputFormat !== 'commonjs') {
            throw getThrowableDiagnosticForNode(
              "`require.resolve` calls for excluded assets are only supported with outputFormat: 'commonjs'",
              mapped.filePath,
              node.loc,
            );
          }

          return REQUIRE_RESOLVE_CALL_TEMPLATE({
            ID: t.stringLiteral(dep.moduleSpecifier),
          });
        } else {
          throw getThrowableDiagnosticForNode(
            "`require.resolve` calls for bundled modules or bundled assets aren't supported with scope hoisting",
            mapped.filePath,
            node.loc,
          );
        }
      } else if (callee.name === '$parcel$exportWildcard') {
        if (args.length !== 2 || !isIdentifier(args[0])) {
          throw new Error('Invalid call to $parcel$exportWildcard');
        }

        if (!needsExportsIdentifier(args[0].name)) {
          return REMOVE;
        }
      }
    },
    VariableDeclarator: {
      exit(node, state, ancestors) {
        let {id, init} = node;

        if (isIdentifier(id)) {
          if (!needsExportsIdentifier(id.name)) {
            return REMOVE;
          }

          if (!needsDeclaration(id.name)) {
            return REMOVE;
          }
        }

        // Replace references to declarations like `var x = require('x')`
        // with the final export identifier instead.
        // This allows us to potentially replace accesses to e.g. `x.foo` with
        // a variable like `$id$export$foo` later, avoiding the exports object altogether.
        if (!isIdentifier(init)) {
          return;
        }

        let module = exportsMap.get(init.name);
        if (!module) {
          return;
        }

        let isGlobal = true;
        for (let i = ancestors.length - 1; i > 0; i--) {
          if (
            t.isScope(ancestors[i], ancestors[i - 1]) &&
            !t.isProgram(ancestors[i])
          ) {
            isGlobal = false;
            break;
          }
        }

        // Replace patterns like `var {x} = require('y')` with e.g. `$id$export$x`.
        if (isObjectPattern(id)) {
          let properties = [];
          for (let p of id.properties) {
            if (!isObjectProperty(p)) {
              continue;
            }

            let {computed, key, value} = p;
            if (computed || !isIdentifier(key) || !isIdentifier(value)) {
              continue;
            }

            let {identifier} = resolveSymbol(module, key.name, bundle);
            if (identifier && isGlobal) {
              replacements.set(value.name, identifier);
            } else {
              properties.push(p);
            }
          }

          if (properties.length === 0) {
            return REMOVE;
          } else {
            let res = t.cloneNode(node);
            invariant(isObjectPattern(res.id));
            res.id.properties = properties;
            return res;
          }
        } else if (isIdentifier(id)) {
          if (isGlobal) {
            replacements.set(id.name, init.name);
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
    MemberExpression: {
      exit(node, state, ancestors) {
        let {object, property, computed} = node;
        if (
          !(
            isIdentifier(object) &&
            ((isIdentifier(property) && !computed) || isStringLiteral(property))
          )
        ) {
          return;
        }

        let asset = exportsMap.get(object.name);
        if (!asset) {
          return;
        }

        // If it's a $id$exports.name expression.
        let name = isIdentifier(property) ? property.name : property.value;
        let {identifier} = resolveSymbol(asset, name, bundle);

        if (identifier == null) {
          return;
        }

        let parent = ancestors[ancestors.length - 2];
        // // If inside an expression, update the actual export binding as well
        if (!isAssignmentExpression(parent, {left: node})) {
          return t.identifier(identifier);
        }
      },
    },
    AssignmentExpression: {
      exit(node, state, ancestors) {
        if (!isMemberExpression(node.left)) {
          return;
        }

        let {object, property, computed} = node.left;
        if (
          !(
            isIdentifier(object) &&
            ((isIdentifier(property) && !computed) || isStringLiteral(property))
          )
        ) {
          return;
        }

        let asset = exportsMap.get(object.name);
        if (!asset) {
          return;
        }

        if (!needsExportsIdentifier(object.name)) {
          if (!isExpressionStatement(ancestors[ancestors.length - 2])) {
            return node.right;
          }

          return REMOVE;
        }

        // If it's a $id$exports.name expression.
        let name = isIdentifier(property) ? property.name : property.value;
        let {identifier} = resolveSymbol(asset, name, bundle);

        if (identifier == null) {
          return;
        }

        let {right} = node;
        if (isIdentifier(right)) {
          let res = maybeReplaceIdentifier(right, ancestors);
          if (res) {
            right = res;
          }
        }

        // do not modify `$id$exports.foo = $id$export$foo` statements
        if (!isIdentifier(right, {name: identifier})) {
          // turn `$exports.foo = ...` into `$exports.foo = $export$foo = ...`
          right = t.assignmentExpression('=', t.identifier(identifier), right);
        }

        node = t.cloneNode(node);
        node.right = right;
        return node;
      },
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

        return maybeReplaceIdentifier(node, ancestors);
      }
    },
    ExpressionStatement: {
      exit(node, state, ancestors) {
        if (node.expression == null) {
          return generatePlaceholders(ancestors, REMOVE);
        }

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

          if (!needsDeclaration(left.name)) {
            return generatePlaceholders(ancestors, REMOVE);
          }
        }

        return generatePlaceholders(ancestors, node);
      },
    },
    Program: {
      exit(node) {
        // $FlowFixMe
        let statements: Array<BabelNode> = node.body;

        // for (let file of importedFiles.values()) {
        //   if (file.bundle) {
        //     let res = format.generateBundleImports(
        //       bundleGraph,
        //       bundle,
        //       file,
        //       scope,
        //     );
        //     statements = res.concat(statements);
        //   } else {
        //     let res = format.generateExternalImport(bundle, file, scope);
        //     statements = res.concat(statements);
        //   }
        // }

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
        // let exported = format.generateBundleExports(
        //   bundleGraph,
        //   bundle,
        //   referencedAssets,
        //   reexports,
        // );

        // statements = statements.concat(exported);

        for (let name of scope.names) {
          let helper = helpers.get(name);
          if (helper) {
            statements.unshift(helper);
          }
        }

        // $FlowFixMe
        return t.program(statements);
      },
    },
  });

  return {ast, referencedAssets};
}

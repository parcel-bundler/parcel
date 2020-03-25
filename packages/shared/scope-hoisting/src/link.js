// @flow

import type {
  Asset,
  Bundle,
  BundleGraph,
  PluginOptions,
  Symbol,
} from '@parcel/types';
import type {ExternalModule, ExternalBundle} from './types';
import type {
  Expression,
  File,
  Identifier,
  LVal,
  Statement,
  ObjectProperty,
  StringLiteral,
  VariableDeclaration,
} from '@babel/types';
import type {NodePath} from '@babel/traverse';

import nullthrows from 'nullthrows';
import invariant from 'assert';
import {relative} from 'path';
import template from '@babel/template';
import * as t from '@babel/types';
import {
  isExpressionStatement,
  isIdentifier,
  isObjectPattern,
  isSequenceExpression,
  isStringLiteral,
} from '@babel/types';
import traverse from '@babel/traverse';
import treeShake from './shake';
import {assertString, getName, getIdentifier} from './utils';
import OutputFormats from './formats/index.js';

const ESMODULE_TEMPLATE = template.statement<
  {|EXPORTS: Expression|},
  Statement,
>(`$parcel$defineInteropFlag(EXPORTS);`);
const DEFAULT_INTEROP_TEMPLATE = template.statement<
  {|
    NAME: LVal,
    MODULE: Expression,
  |},
  VariableDeclaration,
>('var NAME = $parcel$interopDefault(MODULE);');
const THROW_TEMPLATE = template.statement<{|MODULE: StringLiteral|}, Statement>(
  '$parcel$missingModule(MODULE);',
);
const REQUIRE_RESOLVE_CALL_TEMPLATE = template.expression<
  {|ID: StringLiteral|},
  Expression,
>('require.resolve(ID)');
const FAKE_INIT_TEMPLATE = template.statement<
  {|INIT: Identifier, EXPORTS: Identifier|},
  Statement,
>(`function INIT(){
  return EXPORTS;
}`);

export function link({
  bundle,
  bundleGraph,
  ast,
  options,
}: {|
  bundle: Bundle,
  bundleGraph: BundleGraph,
  ast: File,
  options: PluginOptions,
|}) {
  let format = OutputFormats[bundle.env.outputFormat];
  let replacements: Map<Symbol, Symbol> = new Map();
  let imports: Map<Symbol, ?[Asset, Symbol]> = new Map();
  let assets: Map<string, Asset> = new Map();
  let exportsMap: Map<Symbol, Asset> = new Map();

  let importedFiles = new Map<string, ExternalModule | ExternalBundle>();
  let referencedAssets = new Set();

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

  // Build a mapping of all imported identifiers to replace.
  bundle.traverseAssets(asset => {
    assets.set(assertString(asset.meta.id), asset);
    exportsMap.set(assertString(asset.meta.exportsIdentifier), asset);

    for (let dep of bundleGraph.getDependencies(asset)) {
      let resolved = bundleGraph.getDependencyResolution(dep, bundle);

      // If the dependency was deferred, the `...$import$..` identifier needs to be removed.
      // If the dependency was excluded, it will be replaced by the output format at the very end.
      if (resolved || dep.isDeferred) {
        for (let [imported, local] of dep.symbols) {
          imports.set(local, resolved ? [resolved, imported] : null);
        }
      }
    }

    if (bundleGraph.isAssetReferencedByAnotherBundleOfType(asset, 'js')) {
      referencedAssets.add(asset);
    }
  });

  function resolveSymbol(inputAsset, inputSymbol: Symbol) {
    let {asset, exportSymbol, symbol} = bundleGraph.resolveSymbol(
      inputAsset,
      inputSymbol,
    );
    let identifier = symbol;

    // If this is a wildcard import, resolve to the exports object.
    if (asset && exportSymbol === '*') {
      identifier = assertString(asset.meta.exportsIdentifier);
    }

    if (replacements && identifier && replacements.has(identifier)) {
      identifier = replacements.get(identifier);
    }

    return {asset: asset, symbol: exportSymbol, identifier};
  }

  // path is an Identifier that directly imports originalName from originalModule
  function replaceExportNode(originalModule, originalName, path) {
    let {asset: mod, symbol, identifier} = resolveSymbol(
      originalModule,
      originalName,
    );
    let node;

    if (identifier) {
      node = findSymbol(path, identifier);
    }

    // If the module is not in this bundle, create a `require` call for it.
    if (!node && (!mod.meta.id || !assets.has(assertString(mod.meta.id)))) {
      node = addBundleImport(originalModule, path);
      return node ? interop(originalModule, symbol, path, node) : null;
    }

    // If this is an ES6 module, throw an error if we cannot resolve the module
    if (!node && !mod.meta.isCommonJS && mod.meta.isES6Module) {
      let relativePath = relative(options.inputFS.cwd(), mod.filePath);
      throw new Error(`${relativePath} does not export '${symbol}'`);
    }

    // If it is CommonJS, look for an exports object.
    if (!node && mod.meta.isCommonJS) {
      node = findSymbol(path, assertString(mod.meta.exportsIdentifier));
      if (!node) {
        return null;
      }

      return interop(mod, symbol, path, node);
    }

    return node;
  }

  function findSymbol(path, symbol) {
    if (symbol && replacements.has(symbol)) {
      symbol = replacements.get(symbol);
    }

    // if the symbol is in the scope there is no need to remap it
    if (symbol && path.scope.getProgramParent().hasBinding(symbol)) {
      return t.identifier(symbol);
    }

    return null;
  }

  function interop(mod, originalName, path, node) {
    // Handle interop for default imports of CommonJS modules.
    if (mod.meta.isCommonJS && originalName === 'default') {
      let name = getName(mod, '$interop$default');
      if (!path.scope.getBinding(name)) {
        // Hoist to the nearest path with the same scope as the exports is declared in
        let binding = path.scope.getBinding(
          assertString(mod.meta.exportsIdentifier),
        );
        let parent;
        if (binding) {
          parent = path.findParent(
            p => getScopeBefore(p) === binding.scope && p.isStatement(),
          );
        }

        if (!parent) {
          parent = path.getStatementParent();
        }

        let [decl] = parent.insertBefore(
          DEFAULT_INTEROP_TEMPLATE({
            NAME: t.identifier(name),
            MODULE: node,
          }),
        );

        if (binding) {
          binding.reference(
            decl.get<NodePath<Identifier>>('declarations.0.init'),
          );
        }

        getScopeBefore(parent).registerDeclaration(decl);
      }

      return t.identifier(name);
    }

    // if there is a CommonJS export return $id$exports.name
    if (originalName !== '*') {
      return t.memberExpression(node, t.identifier(originalName));
    }

    return node;
  }

  function getScopeBefore(path) {
    return path.isScope() ? path.parentPath.scope : path.scope;
  }

  function isUnusedValue(path) {
    let {parent} = path;
    return (
      isExpressionStatement(parent) ||
      (isSequenceExpression(parent) &&
        ((Array.isArray(path.container) &&
          path.key !== path.container.length - 1) ||
          isUnusedValue(path.parentPath)))
    );
  }

  function addExternalModule(path, dep) {
    // Find an existing import for this specifier, or create a new one.
    let importedFile = importedFiles.get(dep.moduleSpecifier);
    if (!importedFile) {
      importedFile = {
        source: dep.moduleSpecifier,
        specifiers: new Map(),
        isCommonJS: !!dep.meta.isCommonJS,
      };

      importedFiles.set(dep.moduleSpecifier, importedFile);
    }

    let programScope = path.scope.getProgramParent();

    invariant(importedFile.specifiers != null);
    let specifiers = importedFile.specifiers;

    // For each of the imported symbols, add to the list of imported specifiers.
    for (let [imported, symbol] of dep.symbols) {
      // If already imported, just add the already renamed variable to the mapping.
      let renamed = specifiers.get(imported);
      if (renamed) {
        replacements.set(symbol, renamed);
        continue;
      }

      renamed = replacements.get(symbol);
      if (!renamed) {
        // Rename the specifier to something nicer. Try to use the imported
        // name, except for default and namespace imports, and if the name is
        // already in scope.
        renamed = imported;
        if (imported === 'default' || imported === '*') {
          renamed = programScope.generateUid(dep.moduleSpecifier);
        } else if (
          programScope.hasBinding(imported) ||
          programScope.hasReference(imported)
        ) {
          renamed = programScope.generateUid(imported);
        }

        programScope.references[renamed] = true;
        replacements.set(symbol, renamed);
      }

      specifiers.set(imported, renamed);
    }

    return specifiers.get('*');
  }

  function addBundleImport(mod, path) {
    // Find the first bundle containing this asset, and create an import for it if needed.
    // An asset may be duplicated in multiple bundles, so try to find one that matches
    // the current environment if possible and fall back to the first one.
    let bundles = bundleGraph.findBundlesWithAsset(mod);
    let importedBundle =
      bundles.find(b => b.env.context === bundle.env.context) || bundles[0];
    let filePath = nullthrows(importedBundle.filePath);
    let imported = importedFiles.get(filePath);
    if (!imported) {
      imported = {
        bundle: importedBundle,
        assets: new Set(),
      };
      importedFiles.set(filePath, imported);
    }

    // If not unused, add the asset to the list of specifiers to import.
    if (!isUnusedValue(path) && mod.meta.exportsIdentifier) {
      invariant(imported.assets != null);
      imported.assets.add(mod);

      return t.callExpression(getIdentifier(mod, 'init'), []);
    }
  }

  traverse(ast, {
    CallExpression(path) {
      let {arguments: args, callee} = path.node;
      if (!isIdentifier(callee)) {
        return;
      }

      // each require('module') call gets replaced with $parcel$require(id, 'module')
      if (callee.name === '$parcel$require') {
        let [id, source] = args;
        if (
          args.length !== 2 ||
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

        let mod = bundleGraph.getDependencyResolution(dep, bundle);
        let node;

        if (!mod) {
          if (dep.isOptional) {
            path.replaceWith(
              THROW_TEMPLATE({MODULE: t.stringLiteral(source.value)}),
            );
          } else if (dep.isWeak && dep.isDeferred) {
            path.remove();
          } else {
            let name = addExternalModule(path, dep);
            if (isUnusedValue(path) || !name) {
              path.remove();
            } else {
              path.replaceWith(t.identifier(name));
            }
          }
        } else {
          if (mod.meta.id && assets.get(assertString(mod.meta.id))) {
            let name = assertString(mod.meta.exportsIdentifier);

            let isReferenced = bundleGraph.isAssetReferencedByAnotherBundleOfType(
              mod,
              'js',
            );
            let isValueUsed = !isUnusedValue(path);
            if (isValueUsed || isReferenced) {
              // Insert __esModule interop flag if the required module is an ES6 module with a default export.
              // This ensures that code generated by Babel and other tools works properly.
              const hasESModuleDefaultExport =
                mod.meta.isES6Module && mod.symbols.has('default');
              const isUsed = asset.meta.isCommonJS && hasESModuleDefaultExport;
              // TODO If referenced it might be used in another bundle, even though we don't know for sure. If not included but required, the code would throw so we insert it always for now. We should find out when it is required and exclude it if now.
              const mightBeUsed = isReferenced && hasESModuleDefaultExport;
              if (isUsed || mightBeUsed) {
                let binding = path.scope.getBinding(name);
                if (binding && !binding.path.getData('hasESModuleFlag')) {
                  if (binding.path.node.init) {
                    binding.path
                      .getStatementParent()
                      .insertAfter(
                        ESMODULE_TEMPLATE({EXPORTS: t.identifier(name)}),
                      );
                  }

                  for (let path of binding.constantViolations) {
                    path.insertAfter(
                      ESMODULE_TEMPLATE({EXPORTS: t.identifier(name)}),
                    );
                  }

                  binding.path.setData('hasESModuleFlag', true);
                }
              }
            }

            // We need to wrap the module in a function when a require
            // call happens inside a non top-level scope, e.g. in a
            // function, if statement, or conditional expression.
            if (mod.meta.shouldWrap) {
              node = t.callExpression(getIdentifier(mod, 'init'), []);
            }
            // Replace with nothing if the require call's result is not used.
            else if (isValueUsed) {
              node = t.identifier(replacements.get(name) || name);
            }
          } else if (mod.type === 'js') {
            node = addBundleImport(mod, path);
          }

          if (node) {
            path.replaceWith(node);
          } else {
            path.remove();
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
            // TODO add loc information once available
            throw new Error(
              "`require.resolve` calls for excluded assets are only supported with outputFormat = 'commonjs'",
            );
          }

          path.replaceWith(
            REQUIRE_RESOLVE_CALL_TEMPLATE({ID: t.stringLiteral(source.value)}),
          );
        } else {
          // TODO add loc information once available
          throw new Error(
            "`require.resolve` calls for bundled modules or bundled assets aren't supported with scope hoisting",
          );
        }
      }
    },
    VariableDeclarator: {
      exit(path) {
        // Replace references to declarations like `var x = require('x')`
        // with the final export identifier instead.
        // This allows us to potentially replace accesses to e.g. `x.foo` with
        // a variable like `$id$export$foo` later, avoiding the exports object altogether.
        let {id, init} = path.node;
        if (!isIdentifier(init)) {
          return;
        }

        let module = exportsMap.get(init.name);
        if (!module) {
          return;
        }

        let isGlobal = path.scope == path.scope.getProgramParent();

        // Replace patterns like `var {x} = require('y')` with e.g. `$id$export$x`.
        if (isObjectPattern(id)) {
          for (let p of path.get<Array<NodePath<ObjectProperty>>>(
            'id.properties',
          )) {
            let {computed, key, value} = p.node;
            if (computed || !isIdentifier(key) || !isIdentifier(value)) {
              continue;
            }

            let {identifier} = resolveSymbol(module, key.name);
            if (identifier) {
              replace(value.name, identifier, p);
              if (isGlobal) {
                replacements.set(value.name, identifier);
              }
            }
          }

          if (id.properties.length === 0) {
            path.remove();
          }
        } else if (isIdentifier(id)) {
          replace(id.name, init.name, path);
          if (isGlobal) {
            replacements.set(id.name, init.name);
          }
        }

        function replace(id, init, path) {
          let binding = nullthrows(path.scope.getBinding(id));
          if (!binding.constant) {
            return;
          }

          for (let ref of binding.referencePaths) {
            ref.replaceWith(t.identifier(init));
          }

          path.remove();
        }
      },
    },
    MemberExpression: {
      exit(path) {
        if (!path.isReferenced()) {
          return;
        }

        let {object, property, computed} = path.node;
        if (
          !(
            isIdentifier(object) &&
            ((isIdentifier(property) && !computed) || isStringLiteral(property))
          )
        ) {
          return;
        }

        let asset = exportsMap.get(object.name);
        if (!asset || asset.meta.resolveExportsBailedOut) {
          return;
        }

        // If it's a $id$exports.name expression.
        let name = isIdentifier(property) ? property.name : property.value;
        let {identifier} = resolveSymbol(asset, name);

        // Check if $id$export$name exists and if so, replace the node by it.
        if (identifier) {
          path.replaceWith(t.identifier(identifier));
        }
      },
    },
    ReferencedIdentifier(path) {
      let {name} = path.node;
      if (typeof name !== 'string') {
        return;
      }

      let replacement = replacements.get(name);
      if (replacement) {
        path.node.name = replacement;
      }

      if (imports.has(name)) {
        let node;
        let imported = imports.get(name);
        if (!imported) {
          // import was deferred
          node = t.objectExpression([]);
        } else {
          let [asset, symbol] = imported;
          node = replaceExportNode(asset, symbol, path);

          // If the export does not exist, replace with an empty object.
          if (!node) {
            node = t.objectExpression([]);
          }
        }
        path.replaceWith(node);
        return;
      }

      // If it's an undefined $id$exports identifier.
      if (exportsMap.has(name) && !path.scope.hasBinding(name)) {
        path.replaceWith(t.objectExpression([]));
      }
    },
    Program: {
      exit(path) {
        // Recrawl to get all bindings.
        path.scope.crawl();

        // Insert imports for external bundles
        let imports = [];
        for (let file of importedFiles.values()) {
          if (file.bundle) {
            imports.push(
              ...format.generateBundleImports(
                bundle,
                file.bundle,
                file.assets,
                path.scope,
              ),
            );
          } else {
            imports.push(
              ...format.generateExternalImport(bundle, file, path.scope),
            );
          }
        }

        if (imports.length > 0) {
          // Add import statements and update scope to collect references
          path.unshiftContainer('body', imports);
          path.scope.crawl();
        }

        // Insert fake init functions that will be imported in other bundles,
        // because `asset.meta.shouldWrap` isn't set in a packager if `asset` is
        // not in the current bundle:
        path.pushContainer(
          'body',
          [...referencedAssets]
            .filter(a => !a.meta.shouldWrap)
            .map(a => {
              return FAKE_INIT_TEMPLATE({
                INIT: getIdentifier(a, 'init'),
                EXPORTS: t.identifier(assertString(a.meta.exportsIdentifier)),
              });
            }),
        );

        // Generate exports
        let exported = format.generateExports(
          bundleGraph,
          bundle,
          referencedAssets,
          path,
          replacements,
          options,
        );

        treeShake(path.scope, exported);
      },
    },
  });

  return ast;
}

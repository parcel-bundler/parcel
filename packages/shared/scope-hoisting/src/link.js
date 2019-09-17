// @flow

import type {
  Asset,
  AST,
  Bundle,
  BundleGraph,
  PluginOptions,
  Symbol
} from '@parcel/types';

import nullthrows from 'nullthrows';
import {relative} from 'path';
import template from '@babel/template';
import * as t from '@babel/types';
import traverse from '@babel/traverse';
import treeShake from './shake';
import mangleScope from './mangler';
import {getName, getIdentifier} from './utils';
import addExports from './export';
import {urlJoin} from '@parcel/utils';

const ESMODULE_TEMPLATE = template(`$parcel$defineInteropFlag(EXPORTS);`);
const DEFAULT_INTEROP_TEMPLATE = template(
  'var NAME = $parcel$interopDefault(MODULE)'
);
const THROW_TEMPLATE = template('$parcel$missingModule(MODULE)');
const REQUIRE_TEMPLATE = template('parcelRequire(ID)');

export function link({
  bundle,
  bundleGraph,
  ast,
  options
}: {
  bundle: Bundle,
  bundleGraph: BundleGraph,
  ast: AST,
  options: PluginOptions,
  ...
}) {
  let replacements: Map<Symbol, Symbol> = new Map();
  let imports: Map<Symbol, [Asset, Symbol]> = new Map();
  let assets: Map<string, Asset> = new Map();
  let exportsMap: Map<Symbol, Asset> = new Map();

  let imported = new Set();

  let exportedIdentifiers = new Map();
  let entry = bundle.getMainEntry();
  if (entry && bundle.isEntry) {
    for (let [exportName, symbol] of entry.symbols) {
      exportedIdentifiers.set(symbol, exportName);
    }
  }

  // Build a mapping of all imported identifiers to replace.
  bundle.traverseAssets(asset => {
    assets.set(asset.id, asset);
    exportsMap.set(getName(asset, 'exports'), asset);
    for (let dep of bundleGraph.getDependencies(asset)) {
      let resolved = bundleGraph.getDependencyResolution(dep);
      if (resolved) {
        for (let [imported, local] of dep.symbols) {
          imports.set(local, [resolved, imported]);
        }
      }
    }

    if (bundleGraph.isAssetReferencedByAssetType(asset, 'js')) {
      let exportsId = getName(asset, 'exports');
      exportedIdentifiers.set(exportsId, exportsId);
    }
  });

  function resolveSymbol(inputAsset, inputSymbol) {
    let {asset, exportSymbol, symbol} = bundleGraph.resolveSymbol(
      inputAsset,
      inputSymbol
    );
    let identifier = symbol;

    // If this is a wildcard import, resolve to the exports object.
    if (asset && identifier === '*') {
      identifier = getName(asset, 'exports');
    }

    if (replacements && identifier && replacements.has(identifier)) {
      identifier = replacements.get(identifier);
    }

    return {asset: asset, symbol: exportSymbol, identifier};
  }

  function replaceExportNode(module, originalName, path) {
    let {asset: mod, symbol, identifier} = resolveSymbol(module, originalName);
    let node;

    if (identifier) {
      node = findSymbol(path, identifier);
    }

    // If the module is not in this bundle, create a `require` call for it.
    if (!node && !assets.has(mod.id)) {
      let bundles = bundleGraph.findBundlesWithAsset(mod);
      console.log(mod.filePath, bundles.map(b => b.filePath));
      node = REQUIRE_TEMPLATE({ID: t.stringLiteral(module.id)}).expression;
      return interop(module, symbol, path, node);
    }

    // If this is an ES6 module, throw an error if we cannot resolve the module
    if (!node && !mod.meta.isCommonJS && mod.meta.isES6Module) {
      let relativePath = relative(options.rootDir, mod.filePath);
      throw new Error(`${relativePath} does not export '${symbol}'`);
    }

    // If it is CommonJS, look for an exports object.
    if (!node && mod.meta.isCommonJS) {
      node = findSymbol(path, getName(mod, 'exports'));
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
    if (path.scope.getProgramParent().hasBinding(symbol)) {
      return t.identifier(symbol);
    }

    return null;
  }

  function interop(mod, originalName, path, node) {
    // Handle interop for default imports of CommonJS modules.
    if (mod.meta.isCommonJS && originalName === 'default') {
      let name = getName(mod, '$interop$default');
      if (!path.scope.getBinding(name)) {
        let [decl] = path.getStatementParent().insertBefore(
          DEFAULT_INTEROP_TEMPLATE({
            NAME: t.identifier(name),
            MODULE: node
          })
        );

        let binding = path.scope.getBinding(getName(mod, 'exports'));
        if (binding) {
          binding.reference(decl.get('declarations.0.init'));
        }

        path.scope.registerDeclaration(decl);
      }

      return t.memberExpression(t.identifier(name), t.identifier('d'));
    }

    // if there is a CommonJS export return $id$exports.name
    if (originalName !== '*') {
      return t.memberExpression(node, t.identifier(originalName));
    }

    return node;
  }

  function isUnusedValue(path) {
    return (
      path.parentPath.isExpressionStatement() ||
      (path.parentPath.isSequenceExpression() &&
        (path.key !== path.container.length - 1 ||
          isUnusedValue(path.parentPath)))
    );
  }

  traverse(ast, {
    CallExpression(path) {
      let {arguments: args, callee} = path.node;
      if (!t.isIdentifier(callee)) {
        return;
      }

      // each require('module') call gets replaced with $parcel$require(id, 'module')
      if (callee.name === '$parcel$require') {
        let [id, source] = args;
        if (
          args.length !== 2 ||
          !t.isStringLiteral(id) ||
          !t.isStringLiteral(source)
        ) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$require(number, string)'
          );
        }

        let asset = nullthrows(assets.get(id.value));
        let dep = nullthrows(
          bundleGraph
            .getDependencies(asset)
            .find(dep => dep.moduleSpecifier === source.value)
        );
        let mod = bundleGraph.getDependencyResolution(dep);

        if (!mod) {
          if (dep.isOptional) {
            path.replaceWith(
              THROW_TEMPLATE({MODULE: t.stringLiteral(source.value)})
            );
          } else if (dep.isWeak) {
            path.remove();
          } else {
            throw new Error(
              `Cannot find module "${source.value}" in asset ${id.value}`
            );
          }
        } else {
          let node;
          if (assets.get(mod.id)) {
            // Replace with nothing if the require call's result is not used.
            if (!isUnusedValue(path)) {
              let name = getName(mod, 'exports');
              node = t.identifier(replacements.get(name) || name);

              // Insert __esModule interop flag if the required module is an ES6 module with a default export.
              // This ensures that code generated by Babel and other tools works properly.
              if (
                asset.meta.isCommonJS &&
                mod.meta.isES6Module &&
                mod.symbols.has('default')
              ) {
                let binding = path.scope.getBinding(name);
                if (binding && !binding.path.getData('hasESModuleFlag')) {
                  if (binding.path.node.init) {
                    binding.path
                      .getStatementParent()
                      .insertAfter(ESMODULE_TEMPLATE({EXPORTS: name}));
                  }

                  for (let path of binding.constantViolations) {
                    path.insertAfter(ESMODULE_TEMPLATE({EXPORTS: name}));
                  }

                  binding.path.setData('hasESModuleFlag', true);
                }
              }
            }

            // We need to wrap the module in a function when a require
            // call happens inside a non top-level scope, e.g. in a
            // function, if statement, or conditional expression.
            if (mod.meta.shouldWrap) {
              let call = t.callExpression(getIdentifier(mod, 'init'), []);
              node = node ? t.sequenceExpression([call, node]) : call;
            }
          } else if (mod.type === 'js') {
            if (imported.has(mod)) {
              return;
            }

            imported.add(mod);
            let bundles = bundleGraph.findBundlesWithAsset(mod);
            // node = REQUIRE_TEMPLATE({ID: t.stringLiteral(mod.id)}).expression;
            if (!isUnusedValue(path)) {
              node = getIdentifier(mod, 'exports');
            }

            path.scope
              .getProgramParent()
              .path.unshiftContainer('body', [
                t.importDeclaration(
                  node ? [t.importSpecifier(node, node)] : [],
                  t.stringLiteral(
                    urlJoin(bundles[0].target.publicUrl, bundles[0].name)
                  )
                )
              ]);
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
          !t.isStringLiteral(id) ||
          !t.isStringLiteral(source)
        ) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$require$resolve(number, string)'
          );
        }

        let mapped = nullthrows(assets.get(id.value));
        let dep = nullthrows(
          bundleGraph
            .getDependencies(mapped)
            .find(dep => dep.moduleSpecifier === source.value)
        );
        let mod = nullthrows(bundleGraph.getDependencyResolution(dep));
        path.replaceWith(t.valueToNode(mod.id));
      }
    },
    VariableDeclarator: {
      exit(path) {
        // Replace references to declarations like `var x = require('x')`
        // with the final export identifier instead.
        // This allows us to potentially replace accesses to e.g. `x.foo` with
        // a variable like `$id$export$foo` later, avoiding the exports object altogether.
        let {id, init} = path.node;
        if (!t.isIdentifier(init)) {
          return;
        }

        let module = exportsMap.get(init.name);
        if (!module) {
          return;
        }

        // Replace patterns like `var {x} = require('y')` with e.g. `$id$export$x`.
        if (t.isObjectPattern(id)) {
          for (let p of path.get('id.properties')) {
            let {computed, key, value} = p.node;
            if (computed || !t.isIdentifier(key) || !t.isIdentifier(value)) {
              continue;
            }

            let {identifier} = resolveSymbol(module, key.name);
            if (identifier) {
              replace(value.name, identifier, p);
            }
          }

          if (id.properties.length === 0) {
            path.remove();
          }
        } else if (t.isIdentifier(id)) {
          replace(id.name, init.name, path);
        }

        function replace(id, init, path) {
          let binding = path.scope.getBinding(id);
          if (!binding.constant) {
            return;
          }

          for (let ref of binding.referencePaths) {
            ref.replaceWith(t.identifier(init));
          }

          replacements.set(id, init);
          path.remove();
        }
      }
    },
    MemberExpression: {
      exit(path) {
        if (!path.isReferenced()) {
          return;
        }

        let {object, property, computed} = path.node;
        if (
          !(
            t.isIdentifier(object) &&
            ((t.isIdentifier(property) && !computed) ||
              t.isStringLiteral(property))
          )
        ) {
          return;
        }

        let module = exportsMap.get(object.name);
        if (!module) {
          return;
        }

        // If it's a $id$exports.name expression.
        let name = t.isIdentifier(property) ? property.name : property.value;
        let {identifier} = resolveSymbol(module, name);

        // Check if $id$export$name exists and if so, replace the node by it.
        if (identifier) {
          path.replaceWith(t.identifier(identifier));
        }
      }
    },
    ReferencedIdentifier(path) {
      let {name} = path.node;
      if (typeof name !== 'string') {
        return;
      }

      if (imports.has(name)) {
        let [asset, symbol] = nullthrows(imports.get(name));
        let node = replaceExportNode(asset, symbol, path);

        // If the export does not exist, replace with an empty object.
        if (!node) {
          node = t.objectExpression([]);
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
      // A small optimization to remove unused CommonJS exports as sometimes Uglify doesn't remove them.
      exit(path) {
        treeShake(path.scope, exportedIdentifiers);

        // If outputing an ES module, add export statements to exported declarations.
        let exported = new Set();
        if (bundle.env.isModule) {
          exported = addExports(path, exportedIdentifiers);
        }

        if (options.minify) {
          mangleScope(path.scope, exported);
        }
      }
    }
  });

  return ast;
}

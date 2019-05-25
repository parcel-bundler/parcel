// @flow

import type {Asset, AST, Bundle, ParcelOptions, Symbol} from '@parcel/types';

import nullthrows from 'nullthrows';
import {relative} from 'path';
import template from '@babel/template';
import * as t from '@babel/types';
import traverse from '@babel/traverse';
import treeShake from './shake';
import mangleScope from './mangler';
import {getName, getIdentifier, removeReference} from './utils';

const ESMODULE_TEMPLATE = template(`$parcel$defineInteropFlag(EXPORTS);`);
const DEFAULT_INTEROP_TEMPLATE = template(
  'var NAME = $parcel$interopDefault(MODULE)'
);
const THROW_TEMPLATE = template('$parcel$missingModule(MODULE)');
const REQUIRE_TEMPLATE = template('parcelRequire(ID)');

export function link(bundle: Bundle, ast: AST, options: ParcelOptions) {
  let replacements: Map<Symbol, Symbol> = new Map();
  let imports: Map<Symbol, [Asset, Symbol]> = new Map();
  let assets: Map<string, Asset> = new Map();
  let exportsMap: Map<Symbol, Asset> = new Map();

  // Build a mapping of all imported identifiers to replace.
  bundle.traverseAssets(asset => {
    assets.set(asset.id, asset);
    exportsMap.set(getName(asset, 'exports'), asset);
    for (let dep of bundle.getDependencies(asset)) {
      let resolved = bundle.getDependencyResolution(dep);
      if (resolved) {
        for (let [imported, local] of dep.symbols) {
          imports.set(local, [resolved, imported]);
        }
      }
    }
  });

  function resolveSymbol(inputAsset, inputSymbol) {
    let {asset, exportSymbol, symbol} = bundle.resolveSymbol(
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

        // decl =
        // VariableDeclaration{
        //   declarations: [VariableDeclarator{
        //     id: Identifier{name: name},
        //     init: CallExpression{
        //       callee: Identifier{name: '$parcel$interopDefault'},
        //       arguments: [node]
        //     }
        //   }]
        // }
        addIdentifierToBindings(decl.get('declarations.0.id'));
        addIdentifierToBindings(decl.get('declarations.0.init.callee'));
        addIdentifierToBindings(decl.get('declarations.0.init.arguments.0'));

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

  function addIdentifierToBindings(path) {
    if (path.isIdentifier()) {
      let binding = path.scope.getProgramParent().getBinding(path.node.name);
      if (binding) {
        binding.reference(path);
      }
    } else if (path.isMemberExpression()) {
      addIdentifierToBindings(path.get('object'));
    }
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
          bundle
            .getDependencies(asset)
            .find(dep => dep.moduleSpecifier === source.value)
        );
        let mod = bundle.getDependencyResolution(dep);

        if (!mod) {
          if (dep.isOptional) {
            path.replaceWith(
              THROW_TEMPLATE({MODULE: t.stringLiteral(source.value)}).expression
            );
            addIdentifierToBindings(path.get('callee')); // add $parcel$missingModule
          } else if (dep.isWeak) {
            path.remove();
          } else {
            throw new Error(
              `Cannot find module "${source.value}" in asset ${id.value}`
            );
          }
        } else {
          if (assets.get(mod.id)) {
            let node;
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
                    let expr = binding.path
                      .getStatementParent()
                      .insertAfter(ESMODULE_TEMPLATE({EXPORTS: name}))[0];

                    // $parcel$defineInteropFlag($....$exports):
                    addIdentifierToBindings(expr.get('expression.callee'));
                    addIdentifierToBindings(expr.get('expression.arguments.0'));
                  }

                  for (let path of binding.constantViolations) {
                    let expr = path.insertAfter(
                      ESMODULE_TEMPLATE({EXPORTS: name})
                    )[0];
                    addIdentifierToBindings(expr.get('expression.callee'));
                    addIdentifierToBindings(expr.get('expression.arguments.0'));
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
              if (node) {
                node = t.sequenceExpression([call, node]);
                path.replaceWith(node);

                // node = ($...$init(), $...$exports)
                addIdentifierToBindings(path.get('expressions.0.callee'));
                addIdentifierToBindings(path.get('expressions.1'));
              } else {
                node = call;
                path.replaceWith(node);

                // node = CallExpression{callee: Identifier{name: $...$exports}, arguments:[]}
                addIdentifierToBindings(path.get('callee'));
              }
              return;
            } else if (node) {
              path.replaceWith(node);

              // node = Identifier{name: $...$exports}
              addIdentifierToBindings(path);
              return;
            }
          } else if (mod.type === 'js') {
            let node = REQUIRE_TEMPLATE({ID: t.stringLiteral(mod.id)})
              .expression;
            path.replaceWith(node);
            return;
          }

          path.remove();
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
          bundle
            .getDependencies(mapped)
            .find(dep => dep.moduleSpecifier === source.value)
        );
        let mod = nullthrows(bundle.getDependencyResolution(dep));
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
            // is empty now, remove reference to init
            removeReference(path.node.init, path.scope.getProgramParent());
            path.remove();
          }
        } else if (t.isIdentifier(id)) {
          if (replace(id.name, init.name, path)) {
            // remove init reference after successful inlining
            removeReference(init, path.scope.getProgramParent());
          }
        }

        function replace(id, init, path) {
          let binding = path.scope.getBinding(id);
          if (!binding.constant) {
            return false;
          }

          for (let ref of binding.referencePaths) {
            ref.replaceWith(t.identifier(init));
            addIdentifierToBindings(ref);
          }

          replacements.set(id, init);
          path.scope.removeBinding(id);
          path.remove();
          return true;
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
          // remove $id$export$name binding
          removeReference(path.node.object, path.scope.getProgramParent());

          path.replaceWith(t.identifier(identifier));
          // add new (direct) identifier reference
          addIdentifierToBindings(path);
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
          path.replaceWith(node);
        } else {
          path.replaceWith(node);
          addIdentifierToBindings(path);
        }
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
        treeShake(path.scope);

        if (options.minify) {
          mangleScope(path.scope);
        }
      }
    }
  });

  return ast;
}

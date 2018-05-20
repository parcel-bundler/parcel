const {relative} = require('path');
const babylon = require('babylon');
const template = require('babel-template');
const t = require('babel-types');
const traverse = require('babel-traverse').default;
const generate = require('babel-generator').default;

const EXPORTS_RE = /^\$([\d]+)\$exports$/;
const EXPORT_RE = /^\$([\d]+)\$export\$(.+)$/;

const DEFAULT_INTEROP_TEMPLATE = template('$parcel$interopDefault(MODULE)');
const THROW_TEMPLATE = template('$parcel$missingModule(MODULE)');

module.exports = packager => {
  let {contents: code, exports, addedAssets} = packager;
  // console.log(code)
  let ast = babylon.parse(code, {
    allowReturnOutsideFunction: true
  });
  // Share $parcel$interopDefault variables between modules
  let interops = new Map();
  let assets = Array.from(addedAssets).reduce((acc, asset) => {
    acc[asset.id] = asset;

    return acc;
  }, {});

  let resolveModule = (id, name) => {
    let module = assets[id];
    return module.depAssets.get(module.dependencies.get(name));
  };

  function replaceExportNode(id, name, path) {
    let node = find(id, id => `$${id}$export$${name}`);

    if (!node) {
      // if there is no named export then lookup for a CommonJS export
      node = find(id, id => `$${id}$exports`) || t.identifier(`$${id}$exports`);

      console.trace('HIER ' + node.name + '.' + name)

      // if there is a CommonJS export return $id$exports.name
      return t.memberExpression(node, t.identifier(name));
    }

    return node;

    function find(id, symbol) {
      let computedSymbol = symbol(id);

      // if the symbol is in the scope there is not need to remap it
      if (path.scope.getProgramParent().hasBinding(computedSymbol)) {
        return t.identifier(computedSymbol);
      }

      if (exports.has(computedSymbol)) {
        return t.identifier(exports.get(computedSymbol));
      }

      // default exports are excluded from wildcard exports
      if (id in assets && name !== 'default') {
        /* recursively lookup the symbol
         * this is needed when there is deep export wildcards, like in the following:
         * - a.js
         *   > export * from './b'
         * - b.js
         *   > export * from './c'
         * - c.js in es6
         *   > export * from 'lodash'
         * - c.js in cjs
         *   > module.exports = require('lodash')
         */
        let node = null;

        assets[id].cacheData.wildcards.find(
          name => (node = find(resolveModule(id, name).id, symbol))
        );

        return node;
      }

      return null;
    }
  }

  console.time('concat');

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
          !t.isNumericLiteral(id) ||
          !t.isStringLiteral(source)
        ) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$require(number, string)'
          );
        }

        let mod = resolveModule(id.value, source.value);

        if (!mod) {
          if (assets[id.value].dependencies.get(source.value).optional) {
            path.replaceWith(
              THROW_TEMPLATE({MODULE: t.stringLiteral(source.value)})
            );
          } else {
            throw new Error(
              `Cannot find module "${source.value}" in asset ${id.value}`
            );
          }
        } else {
          path.replaceWith(t.identifier(`$${mod.id}$exports`));
        }
      } else if (callee.name === '$parcel$import') {
        let [id, source, name, replace] = args;
        
        replace = path.get('arguments.3').evaluate();

        if (
          args.length !== 4 ||
          !t.isNumericLiteral(id) ||
          !t.isStringLiteral(source) ||
          !t.isStringLiteral(name)// ||
          // !t.isBooleanLiteral(replace)
        ) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$import(number, string, string, boolean)'
          );
        }

        let mod = resolveModule(id.value, source.value);

        if (typeof mod === 'undefined') {
          throw new Error(
            `Cannot find module "${source.value}" in asset ${id.value}`
          );
        }

        let node = replaceExportNode(mod.id, name.value, path);
        let interop = false;

        // If the module has any CommonJS reference, it still can have export/import statements.
        if (mod.cacheData.isCommonJS) {
          if (name.value === 'default') {
            node = t.isMemberExpression(node) ? node.object : node;
            interop = true;

            let nodeName =
              replace.value && t.isIdentifier(node) ? node.name : null;
            let {id} = path.parent;

            if (nodeName !== null && interops.has(nodeName)) {
              let name = t.identifier(interops.get(nodeName));

              // Rename references to the variables to the cached interop name.
              path.scope
                .getBinding(id.name)
                .referencePaths.forEach(reference =>
                  reference.replaceWith(
                    t.memberExpression(name, t.identifier('d'))
                  )
                );
              // Remove the binding and its definition.
              path.scope.removeBinding(id.name);
              path.parentPath.remove();

              return;
            } else {
              node = DEFAULT_INTEROP_TEMPLATE({MODULE: node});

              // Save the variable name of the interop call for further use.
              if (nodeName !== null) {
                interops.set(nodeName, id.name);
              }
            }
          }
        } else if (
          mod.cacheData.isES6Module &&
          !t.isIdentifier(node) &&
          mod.id in assets
        ) {
          let relativePath = relative(packager.options.rootDir, mod.name);

          throw new Error(`${relativePath} does not export '${name.value}'`);
        }

        if (replace.value) {
          if (!path.parentPath.isVariableDeclarator()) {
            throw new Error(
              'invariant: "replace" used outside of a VariableDeclarator'
            );
          }

          let {id} = path.parent;
          let binding = path.scope.getBinding(id.name);

          if (interop) {
            path.replaceWith(node);

            binding.referencePaths.forEach(reference =>
              reference.replaceWith(t.memberExpression(id, t.identifier('d')))
            );
          } else {
            path.scope.removeBinding(id.name);

            binding.path.remove();
            binding.referencePaths.forEach(reference =>
              reference.replaceWith(node)
            );

            if (t.isIdentifier(node)) {
              exports.set(id.name, node.name);
            }
          }
        } else {
          path.replaceWith(node);
        }
      } else if (
        (callee.name === '$parcel$interopDefault' ||
          callee.name === '$parcel$exportWildcard') &&
        !path.getData('markAsPure')
      ) {
        // This hints Uglify and Babel that this CallExpression does not have any side-effects.
        path.addComment('leading', '#__PURE__');
        path.setData('markAsPure', true);
      } else if (callee.name === '$parcel$require$resolve') {
        let [id, source] = args;

        if (
          args.length !== 2 ||
          !t.isNumericLiteral(id) ||
          !t.isStringLiteral(source)
        ) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$require$resolve(number, string)'
          );
        }

        let mapped = assets[id.value];
        let dep = mapped.dependencies.get(source.value);
        let mod = mapped.depAssets.get(dep);
        let bundles = mod.id;

        if (dep.dynamic && packager.bundle.childBundles.has(mod.parentBundle)) {
          bundles = [packager.getBundleSpecifier(mod.parentBundle)];

          for (let child of mod.parentBundle.siblingBundles) {
            if (!child.isEmpty) {
              bundles.push(packager.getBundleSpecifier(child));
            }
          }

          bundles.push(mod.id);
        }

        path.replaceWith(t.valueToNode(bundles));
      }
    },
    MemberExpression(path) {
      if (!path.isReferenced()) {
        return;
      }

      let {object, property} = path.node;
      if (!t.isIdentifier(object) || !t.isIdentifier(property)) {
        return;
      }

      let match = object.name.match(EXPORTS_RE);

      // If it's a $id$exports.name expression.
      if (match) {
        let exportName = '$' + match[1] + '$export$' + property.name;

        // Check if $id$export$name exists and if so, replace the node by it.
        if (path.scope.hasBinding(exportName)) {
          path.replaceWith(t.identifier(exportName));
        }
      }
    },
    ReferencedIdentifier(path) {
      let {name} = path.node;

      if (typeof name !== 'string') {
        return;
      }

      // If it's a renamed export replace it with its alias.
      if (exports.has(name)) {
        path.replaceWith(t.identifier(exports.get(path.node.name)));
      }

      let match = name.match(EXPORT_RE);

      // If it's an undefined $id$export$name identifier.
      if (match && !path.scope.hasBinding(name)) {
        let id = Number(match[1]);
        let exportName = match[2];

        // Check if there is a wildcard or an alias (Identifier), else use CommonJS (MemberExpression).
        path.replaceWith(replaceExportNode(id, exportName, path));

        return;
      }

      match = name.match(EXPORTS_RE);

      // If it's an undefined $id$exports identifier.
      if (match && !path.scope.hasBinding(name)) {
        let id = Number(match[1]);

        // If the id is in the bundle it may just be empty, replace with {}.
        if (id in assets) {
          path.replaceWith(t.objectExpression([]));
        }
        // Else it should be required from another bundle, replace with require(id).
        else {
          path.replaceWith(
            t.callExpression(t.identifier('require'), [t.numericLiteral(id)])
          );
        }

        return;
      }
    },
    Program: {
      // A small optimization to remove unused CommonJS exports as sometimes Uglify doesn't remove them.
      exit(path) {
        // Recrawl to get all bindings.
        path.scope.crawl();

        Object.keys(path.scope.bindings).forEach(name => {
          let binding = getUnusedBinding(path, name);

          // If it is not safe to remove the binding don't touch it.
          if (!binding) {
            return;
          }

          // Remove the binding and all references to it.
          binding.path.remove();
          binding.referencePaths
            .concat(binding.constantViolations)
            .forEach(path => {
              if (path.parentPath.isMemberExpression()) {
                if (path.parentPath.parentPath.parentPath.isSequenceExpression() && path.parentPath.parentPath.parent.expressions.length === 1) {
                  path.parentPath.parentPath.parentPath.remove();
                }
                else if (!path.parentPath.parentPath.removed) {
                  path.parentPath.parentPath.remove();
                }
              } else if (path.isAssignmentExpression()) {
                path.remove();
              }
            });

          path.scope.removeBinding(name);
        });

        let Charset = require('babel-plugin-minify-mangle-names/lib/charset');
        let charset = new Charset(false);
        charset.sort();

        let rename = require('../visitors/renamer');
        let bindings = {};
        let newNames = new Set;
        let size = 0;

        let binds = Object.keys(path.scope.bindings).sort((a, b) => path.scope.bindings[b].referencePaths.length - path.scope.bindings[a].referencePaths.length);

        let scope = path.scope.getProgramParent();

        for (let oldName of binds) {
          let i = 0;
          let newName;

          do {
            newName = charset.getIdentifier(i++);
          } while (!t.isValidIdentifier(newName) || newNames.has(newName) || !canRename(scope, path.scope.bindings[oldName], newName));
          bindings[oldName] = newName;
          newNames.add(newName);

          let binding = path.scope.getBinding(oldName);
          for (let violation of binding.constantViolations) {
            let bindingIds = violation.getBindingIdentifierPaths(true, false);
            for (let name in bindingIds) {
              if (name === oldName) {
                for (let idPath of bindingIds[name]) {
                  idPath.node.name = newName;
                }
              }
            }
          }

          for (let path of binding.referencePaths) {
            if (path.node.name === oldName) {
              path.node.name = newName;
            }
          }

          binding.identifier.name = newName;

          path.scope.bindings[newName] = binding;
          delete path.scope.bindings[oldName];
        }
        
        // console.log(bindings)
        // rename(path.scope, bindings);
      }
    }
  });

  function canRename(scope, binding, newName) {
    for (let i = 0; i < binding.referencePaths.length; i++) {
      const ref = binding.referencePaths[i];
      if (ref.scope.hasBinding(newName) || ref.scope.hasReference(newName)) {
        return false;
      }
    }

    return true;
  }

  console.timeEnd('concat');

  console.time('minify');
  // let tmp = require('babel-core').transformFromAst(ast, code, {
  //   babelrc: false,
  //   code: false,
  //   filename: 'jhi',
  //   plugins: [/*[require('babel-plugin-minify-mangle-names'), {topLevel: true}], */require('babel-plugin-minify-dead-code-elimination')]
  // });

  // ast = tmp.ast;
  console.timeEnd('minify');

  let opts = {
    sourceMaps: packager.options.sourceMaps,
    sourceFileName: packager.bundle.name,
    minified: true,
    comments: false
  };

  console.time('generate');
  let res = generate(ast, opts, code);
  console.timeEnd('generate');
  console.log('\n\n');
  return res;
};

// Check if a binding is safe to remove and returns it if it is.
function getUnusedBinding(path, name) {
  let binding = path.scope.getBinding(name);

  if (
    binding.referencePaths.length === 0 &&
    (binding.path.isPureish() || name.startsWith('$parcel'))
  ) {
    return binding;
  }

  if (!EXPORTS_RE.test(name)) {
    return null;
  }

  // Is there any references which aren't simple assignments?
  let bailout = binding.referencePaths.some(
    path => !isExportAssignment(path) && !isUnusedWildcard(path)
  );

  if (bailout) {
    return null;
  } else {
    return binding;
  }

  function isExportAssignment(path) {
    return (
      // match "path.any = any;"
      path.parentPath.isMemberExpression() &&
      path.parentPath.parentPath.isAssignmentExpression() &&
      path.parentPath.parentPath.node.left === path.parentPath.node
    );
  }

  function isUnusedWildcard(path) {
    let {parent, parentPath} = path;

    return (
      // match "var $id$exports = $parcel$exportWildcard(any, path);"
      t.isCallExpression(parent) &&
      t.isIdentifier(parent.callee, {name: '$parcel$exportWildcard'}) &&
      parent.arguments[1] === path.node &&
      parentPath.parentPath.isVariableDeclarator() &&
      // check if the $id$exports variable is used
      getUnusedBinding(path, parentPath.parent.id.name) !== null
    );
  }
}

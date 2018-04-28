const {relative} = require('path');
const babylon = require('babylon');
const template = require('babel-template');
const t = require('babel-types');
const traverse = require('babel-traverse').default;
const generate = require('babel-generator').default;

const EXPORTS_RE = /^\$([\d]+)\$exports$/;
const EXPORT_RE = /^\$([\d]+)\$export\$(.+)$/;

const DEFAULT_INTEROP_TEMPLATE = template('$parcel$interopDefault(MODULE)');

// TODO: minify
// TODO: source-map

module.exports = packager => {
  let {buffer: code, exports, moduleMap, wildcards} = packager;
  let ast = babylon.parse(code);
  let rootPath;

  // Share $parcel$interopDefault variables between modules
  let interops = new Map();

  let resolveModule = (id, name) => {
    let module = moduleMap.get(id);
    return module.depAssets.get(module.dependencies.get(name));
  };

  function replaceExportNode(id, name, path) {
    if (!rootPath) {
      rootPath = getOuterStatement(path);
    }

    let node = find(id, id => `$${id}$export$${name}`);

    if (!node) {
      // if there is no named export then lookup for a CommonJS export
      node = find(id, id => `$${id}$exports`) || t.identifier(`$${id}$exports`);

      // if there is a CommonJS export return $id$exports.name
      return t.memberExpression(node, t.identifier(name));
    }

    return node;

    function find(id, symbol) {
      let computedSymbol = symbol(id);

      // if the symbol is in the scope there is not need to remap it
      if (rootPath.scope.hasBinding(computedSymbol)) {
        return t.identifier(computedSymbol);
      }

      if (exports.has(computedSymbol)) {
        return t.identifier(exports.get(computedSymbol));
      }

      // if there is a wildcard for the module
      // default exports are excluded from wildcard exports
      if (wildcards.has(id) && name !== 'default') {
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

        wildcards
          .get(id)
          .find(name => (node = find(resolveModule(id, name).id, symbol)));

        return node;
      }

      return null;
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
          !t.isNumericLiteral(id) ||
          !t.isStringLiteral(source)
        ) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$require(number, string)'
          );
        }

        let mod = resolveModule(id.value, source.value);

        if (typeof mod === 'undefined') {
          throw new Error(
            `Cannot find module "${source.value}" in asset ${id.value}`
          );
        }

        path.replaceWith(t.identifier(`$${mod.id}$exports`));
      } else if (callee.name === '$parcel$import') {
        let [id, source, name, replace] = args;

        if (
          args.length !== 4 ||
          !t.isNumericLiteral(id) ||
          !t.isStringLiteral(source) ||
          !t.isStringLiteral(name) ||
          !t.isBooleanLiteral(replace)
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
        } else if (!t.isIdentifier(node)) {
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

        let mapped = moduleMap.get(id.value);
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

        path.replaceWith(toNode(bundles));
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
      if (match) {
        let exportName = '$' + match[1] + '$export$' + property.name;
        if (path.scope.hasBinding(exportName)) {
          path.replaceWith(t.identifier(exportName));
        }

        if (!rootPath) {
          rootPath = getOuterStatement(path);
        }
      }
    },
    Identifier(path) {
      let {name} = path.node;

      if (typeof name !== 'string') {
        return;
      }

      let match = name.match(EXPORT_RE);

      if (match && !path.scope.hasBinding(name)) {
        let id = Number(match[1]);
        let exportName = match[2];
        let node = replaceExportNode(id, exportName, path);

        if (node) {
          path.replaceWith(node);
        } else {
          throw new Error(
            `Cannot find export "${exportName}" in module "${id}"`
          );
        }
      } else if (EXPORTS_RE.test(name) && !path.scope.hasBinding(name)) {
        path.replaceWith(t.objectExpression([]));
      }
    },
    ReferencedIdentifier(path) {
      if (exports.has(path.node.name)) {
        path.replaceWith(t.identifier(exports.get(path.node.name)));
      }
    },
    Program: {
      // A small optimization to remove unused CommonJS exports as sometimes Uglify doesn't remove them.
      exit(path) {
        if (!(path = rootPath)) {
          return;
        }

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
          binding.referencePaths.forEach(({parentPath}) => {
            if (parentPath.isMemberExpression()) {
              if (!parentPath.parentPath.removed) {
                parentPath.parentPath.remove();
              }
            }
          });
        });
      }
    }
  });

  return generate(ast, code).code;
};

// Check if a binding is safe to remove and returns it if it is.
function getUnusedBinding(path, name) {
  if (!EXPORTS_RE.test(name)) {
    return null;
  }

  let binding = path.scope.getBinding(name);
  // Is there any references which aren't simple assignments?
  let bailout = binding.referencePaths.some(
    path => !isExportAssignment(path) && !isUnusedWildcard(path)
  );

  if (bailout) {
    return null;
  } else {
    return binding;
  }

  function isExportAssignment({parentPath}) {
    return (
      // match "path.any = any;"
      parentPath.isMemberExpression() &&
      parentPath.parentPath.isAssignmentExpression() &&
      parentPath.parentPath.node.left === parentPath.node
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

// Finds a parent statement in the bundle IIFE body.
function getOuterStatement(path) {
  if (validate(path)) {
    return path;
  }

  return path.findParent(validate);

  function validate(path) {
    if (!t.isStatement(path.node) || t.isBlockStatement(path.node)) {
      return false;
    }

    // TODO: use scope?
    let outerBlocks = 0;

    path.findParent(parent => {
      if (t.isBlockStatement(parent.node)) {
        outerBlocks++;
      }

      return false;
    });

    return outerBlocks === 1;
  }
}

function toNode(object) {
  if (typeof object === 'string') {
    return t.stringLiteral(object);
  } else if (typeof object === 'number') {
    return t.numericLiteral(object);
  } else if (Array.isArray(object)) {
    return t.arrayExpression(object.map(toNode));
  } else {
    throw new Error('Cannot serialize unsupported object type to AST');
  }
}

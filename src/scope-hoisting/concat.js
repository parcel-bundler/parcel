const {relative} = require('path');
const template = require('@babel/template').default;
const t = require('@babel/types');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const treeShake = require('./shake');
const mangleScope = require('./mangler');
const {getName, getIdentifier} = require('./utils');

const EXPORTS_RE = /^\$([^$]+)\$exports$/;

const DEFAULT_INTEROP_TEMPLATE = template(
  'var NAME = $parcel$interopDefault(MODULE)'
);
const THROW_TEMPLATE = template('$parcel$missingModule(MODULE)');
const REQUIRE_TEMPLATE = template('require(ID)');

module.exports = (packager, ast) => {
  let {assets} = packager;
  let replacements = new Map();
  let imports = new Map();
  let referenced = new Set();

  // Build a mapping of all imported identifiers to replace.
  for (let asset of assets.values()) {
    for (let name in asset.cacheData.imports) {
      let imp = asset.cacheData.imports[name];
      imports.set(name, [packager.resolveModule(asset.id, imp[0]), imp[1]]);
    }
  }

  function replaceExportNode(module, originalName, path) {
    let {identifier, name, id} = packager.findExportModule(
      module.id,
      originalName,
      replacements
    );
    let mod = assets.get(id);
    let node;

    if (identifier) {
      node = findSymbol(path, identifier);
    }

    // If the module is not in this bundle, create a `require` call for it.
    if (!node && !mod) {
      node = REQUIRE_TEMPLATE({ID: t.stringLiteral(id)}).expression;
      return interop(module, name, path, node);
    }

    // If this is an ES6 module, throw an error if we cannot resolve the module
    if (!node && !mod.cacheData.isCommonJS && mod.cacheData.isES6Module) {
      let relativePath = relative(packager.options.rootDir, mod.name);
      throw new Error(`${relativePath} does not export '${name}'`);
    }

    // If it is CommonJS, look for an exports object.
    if (!node && mod.cacheData.isCommonJS) {
      node = findSymbol(path, getName(mod, 'exports'));
      if (!node) {
        return null;
      }

      return interop(mod, name, path, node);
    }

    return node;
  }

  function findSymbol(path, symbol) {
    if (replacements.has(symbol)) {
      symbol = replacements.get(symbol);
    }

    // if the symbol is in the scope there is not need to remap it
    if (path.scope.getProgramParent().hasBinding(symbol)) {
      return t.identifier(symbol);
    }

    return null;
  }

  function interop(mod, originalName, path, node) {
    // Handle interop for default imports of CommonJS modules.
    if (mod.cacheData.isCommonJS && originalName === 'default') {
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

        let mod = packager.resolveModule(id.value, source.value);

        if (!mod) {
          if (assets.get(id.value).dependencies.get(source.value).optional) {
            path.replaceWith(
              THROW_TEMPLATE({MODULE: t.stringLiteral(source.value)})
            );
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
            }

            // We need to wrap the module in a function when a require
            // call happens inside a non top-level scope, e.g. in a
            // function, if statement, or conditional expression.
            if (mod.cacheData.shouldWrap) {
              let call = t.callExpression(getIdentifier(mod, 'init'), []);
              node = node ? t.sequenceExpression([call, node]) : call;
            }
          } else {
            node = REQUIRE_TEMPLATE({ID: t.stringLiteral(mod.id)}).expression;
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

        let mapped = assets.get(id.value);
        let dep = mapped.dependencies.get(source.value);
        let mod = mapped.depAssets.get(dep);
        let bundles = mod.id;

        if (dep.dynamic && packager.bundle.childBundles.has(mod.parentBundle)) {
          bundles = [];

          for (let child of mod.parentBundle.siblingBundles) {
            if (!child.isEmpty && packager.options.bundleLoaders[child.type]) {
              bundles.push(packager.getBundleSpecifier(child));
            }
          }

          bundles.push(packager.getBundleSpecifier(mod.parentBundle));
          bundles.push(mod.id);
        }

        path.replaceWith(t.valueToNode(bundles));
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

        let match = init.name.match(EXPORTS_RE);
        if (!match) {
          return;
        }

        // Replace patterns like `var {x} = require('y')` with e.g. `$id$export$x`.
        if (t.isObjectPattern(id)) {
          for (let p of path.get('id.properties')) {
            let {computed, key, value} = p.node;
            if (computed || !t.isIdentifier(key) || !t.isIdentifier(value)) {
              continue;
            }

            let {identifier} = packager.findExportModule(
              match[1],
              key.name,
              replacements
            );
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

        let match = object.name.match(EXPORTS_RE);

        // If it's a $id$exports.name expression.
        if (match) {
          let name = t.isIdentifier(property) ? property.name : property.value;
          let {identifier} = packager.findExportModule(
            match[1],
            name,
            replacements
          );

          // Check if $id$export$name exists and if so, replace the node by it.
          if (identifier) {
            path.replaceWith(t.identifier(identifier));
          }
        }
      }
    },
    ReferencedIdentifier(path) {
      let {name} = path.node;

      if (typeof name !== 'string') {
        return;
      }

      if (imports.has(name)) {
        let imp = imports.get(name);
        let node = replaceExportNode(imp[0], imp[1], path);

        // If the export does not exist, replace with an empty object.
        if (!node) {
          node = t.objectExpression([]);
        }

        path.replaceWith(node);
        return;
      }

      let match = name.match(EXPORTS_RE);
      if (match) {
        referenced.add(name);
      }

      // If it's an undefined $id$exports identifier.
      if (match && !path.scope.hasBinding(name)) {
        path.replaceWith(t.objectExpression([]));
      }
    },
    Program: {
      // A small optimization to remove unused CommonJS exports as sometimes Uglify doesn't remove them.
      exit(path) {
        treeShake(path.scope);

        if (packager.options.minify) {
          mangleScope(path.scope);
        }
      }
    }
  });

  let opts = {
    sourceMaps: packager.options.sourceMaps,
    sourceFileName: packager.bundle.name,
    minified: packager.options.minify,
    comments: !packager.options.minify
  };

  return generate(ast, opts);
};

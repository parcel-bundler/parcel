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
  let {buffer: code, exports, moduleMap} = packager;
  let ast = babylon.parse(code);
  let rootPath;

  let resolveModule = (id, name) => {
    let module = moduleMap.get(id);
    return module.depAssets.get(module.dependencies.get(name));
  };

  function replaceExportNode(id, name, path, commonJsAsMemberExpr = true) {
    if (!rootPath) {
      rootPath = getOuterStatement(path);
    }

    let node = find(id, id => `$${id}$export$${name}`);

    if (!node) {
      // if there is no named export then lookup for a CommonJS export
      node = find(id, id => `$${id}$exports`) || t.identifier(`$${id}$exports`);

      // if there is a CommonJS export return $id$exports.name
      if (commonJsAsMemberExpr) {
        return t.memberExpression(node, t.identifier(name));
      }
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

        let mod = resolveModule(id.value, source.value).id;

        if (typeof mod === 'undefined') {
          throw new Error(
            `Cannot find module "${source.value}" in asset ${id.value}`
          );
        }

        path.replaceWith(t.identifier(`$${mod}$exports`));
      } else if (callee.name === '$parcel$import') {
        let [id, source, name] = args;

        if (
          args.length !== 3 ||
          !t.isNumericLiteral(id) ||
          !t.isStringLiteral(source) ||
          !t.isStringLiteral(name)
        ) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$import(number, string, string)'
          );
        }

        let mod = resolveModule(id.value, source.value);

        if (typeof mod === 'undefined') {
          throw new Error(
            `Cannot find module "${source.value}" in asset ${id.value}`
          );
        }

        if (name.value === 'default' && mod.cacheData.isCommonJS) {
          path.replaceWith(
            DEFAULT_INTEROP_TEMPLATE({
              MODULE: replaceExportNode(mod.id, name.value, path, false)
            })
          );
        } else {
          path.replaceWith(replaceExportNode(mod.id, name.value, path));
        }
      } else if (callee.name === '$parcel$interopDefault') {
        // This hints Uglify and Babel that this CallExpression does not have any side-effects.
        path.addComment('leading', '#__PURE__');
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
    exit(path) {
      if (!rootPath || !path.isProgram()) {
        return;
      }

      path = rootPath;
      path.scope.crawl();
      Object.keys(path.scope.bindings)
        .filter(name => EXPORTS_RE.test(name))
        .forEach(name => {
          let binding = path.scope.getBinding(name);
          // Is there any references which aren't also simple assignments?
          let bailout = binding.referencePaths.some(
            ({parentPath}) =>
              !parentPath.isMemberExpression() ||
              !parentPath.parentPath.isAssignmentExpression()
          );

          // Is so skip.
          if (bailout) {
            return;
          }

          // Remove each assignement from the code
          binding.referencePaths.forEach(({parentPath}) => {
            if (parentPath.isMemberExpression()) {
              console.log('Removing binding', name);

              parentPath.parentPath.remove();
            } else {
              throw new Error('Unknown exports path type');
            }
          });
        });
    }
  });

  return generate(ast, code).code;
};

// Finds a parent statement in the bundle IIFE body
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

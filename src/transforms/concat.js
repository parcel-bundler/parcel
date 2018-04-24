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

module.exports = (code, exports, moduleMap) => {
  let ast = babylon.parse(code);

  let resolveModule = (id, name) => {
    let module = moduleMap.get(id);
    return module.depAssets.get(module.dependencies.get(name));
  };

  function replaceExportNode(id, name, path, commonJsAsMemberExpr = true) {
    path = getOuterStatement(path);

    let node = find(id, id => `$${id}$export$${name}`);

    if (!node) {
      // if there is no named export then lookup for a CommonJS export
      node = find(id, id => `$${id}$exports`) || t.identifier(`$${id}$exports`);

      // if there is a CommonJS export return $id$exports.name
      if (node) {
        if (commonJsAsMemberExpr) {
          return t.memberExpression(node, t.identifier(name));
        } else {
          return node;
        }
      }
    }

    return node;

    function find(id, symbol) {
      let computedSymbol = symbol(id);

      // if the symbol is in the scope there is not need to remap it
      if (path.scope.hasBinding(computedSymbol)) {
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

      // each require('module') call gets replaced with $parcel$require(id, 'module')
      if (t.isIdentifier(callee, {name: '$parcel$require'})) {
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
          throw new Error(`Cannot find module "${source.value}"`);
        }

        path.replaceWith(t.identifier(`$${mod}$exports`));
      } else if (t.isIdentifier(callee, {name: '$parcel$import'})) {
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
          throw new Error(`Cannot find module "${source.value}"`);
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
      } else if (t.isIdentifier(callee, {name: '$parcel$interopDefault'})) {
        // This hints Uglify and Babel that this CallExpression does not have any side-effects.
        path.addComment('leading', '#__PURE__');
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
        }
      } else if (EXPORTS_RE.test(name) && !path.scope.hasBinding(name)) {
        path.replaceWith(t.objectExpression([]));
      }
    },
    ReferencedIdentifier(path) {
      if (exports.has(path.node.name)) {
        path.replaceWith(t.identifier(exports.get(path.node.name)));
      }
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

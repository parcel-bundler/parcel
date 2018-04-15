const babylon = require('babylon');
const t = require('babel-types');
const traverse = require('babel-traverse').default;
const generate = require('babel-generator').default;

const EXPORTS_RE = /^\$([\d]+)\$exports$/;
const EXPORT_RE = /^\$([\d]+)\$export\$(.+)$/;

// TODO: minify
// TODO: source-map

module.exports = (code, exports, moduleMap, wildcards) => {
  let ast = babylon.parse(code);
  let addedExports = new Set();

  let resolveModule = (id, name) => {
    let module = moduleMap.get(id);
    return module.depAssets.get(module.dependencies.get(name)).id;
  };

  function replaceExportNode(id, name, path) {
    path = getOuterStatement(path);

    let node = find(id, id => `$${id}$export$${name}`);

    if (!node) {
      // if there is no named export then lookup for a CommonJS export
      node = find(id, id => `$${id}$exports`) || t.identifier(`$${id}$exports`);

      // if there is a CommonJS export return $id$exports.name
      if (node) {
        return t.memberExpression(node, t.identifier(name));
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
          .find(name => (node = find(resolveModule(id, name), symbol)));

        return node;
      }

      return null;
    }
  }

  traverse(ast, {
    CallExpression(path) {
      let {arguments: args, callee} = path.node;

      // each require('module') call gets replaced with $parcel$require(id, 'module')
      if (t.isIdentifier(callee, {name: '$parcel$require'})) {
        let [id, name] = args;

        if (
          args.length !== 2 ||
          !t.isNumericLiteral(id) ||
          !t.isStringLiteral(name)
        ) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$require(number, string)'
          );
        }

        let mod = resolveModule(id.value, name.value);

        if (typeof mod === 'undefined') {
          throw new Error(`Cannot find module "${name.value}"`);
        }

        path.replaceWith(t.identifier(`$${mod}$exports`));
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

      if (match && !path.scope.hasBinding(name) && !addedExports.has(name)) {
        let id = Number(match[1]);
        let exportName = match[2];
        let node = replaceExportNode(id, exportName, path);

        addedExports.add(name);

        if (node) {
          path.replaceWith(node);
        }
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

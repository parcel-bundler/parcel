const babylon = require('babylon');
const t = require('babel-types');
const traverse = require('babel-traverse').default;
const generate = require('babel-generator').default;

const EXPORTS_RE = /^\$([\d]+)\$exports$/;
const EXPORT_RE = /^\$([\d]+)\$export\$(.+)$/;

// TODO: minify
// TODO: source-map

module.exports = (code, exports, moduleMap) => {
  let ast = babylon.parse(code);
  let addedExports = new Set();
  let commentedBindings = new Set();

  let resolveModule = (id, name) => {
    let module = moduleMap.get(id);
    return module.depAssets.get(module.dependencies.get(name)).id;
  };

  function replaceExportNode(id, name, path) {
    function tail(symbol) {
      // if the symbol is in the scope there is not need to remap it
      if (path.scope.hasBinding(symbol)) {
        return t.identifier(symbol);
      }

      // if we have an export alias for this symbol
      if (exports.has(symbol)) {
        /* recursively lookup the symbol
         * this is needed when we have deep export wildcards, like in the following:
         * - a.js
         *   > export * from './b'
         * - b.js
         *   > export * from './c'
         * - c.js in es6
         *   > export * from 'lodash'
         * - c.js in cjs
         *   > module.exports = require('lodash')
         */
        let node = tail(exports.get(symbol));

        if (node) {
          return node;
        }
      }

      return null;
    }
    let node = tail(`$${id}$export$${name}`);

    if (!node) {
      // if there is no named export then lookup for a CommonJS export
      let commonJs = `$${id}$exports`;
      node = tail(commonJs);

      // if we have a CommonJS export return $id$exports.name
      if (node) {
        return t.memberExpression(node, t.identifier(name));
      }

      // if there is no binding for the symbol it'll probably fail at runtime
      throw new Error(`Cannot find export "${name}" in module ${id}`);
    }

    return node;
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

        const mod = resolveModule(id.value, name.value);

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

      let match = name.match(EXPORTS_RE);

      if (match) {
        // let id = Number(match[1]);

        if (!path.scope.hasBinding(name) && !addedExports.has(name)) {
          let exports = moduleMap.get(+match[1]).cacheData.exports;

          addedExports.add(name);

          path.getStatementParent().insertBefore(
            t.variableDeclaration('var', [
              t.variableDeclarator(
                t.identifier(name),
                t.objectExpression(
                  Object.keys(exports)
                    .map(key => {
                      let binding = path.scope.getBinding(key);
                      if (!binding) {
                        return null;
                      }

                      let exportName = exports[key];
                      let expr = replaceExportNode(+match[1], exportName, path);

                      if (expr === null) {
                        return null;
                      }

                      if (binding.constant) {
                        return t.objectProperty(t.identifier(exportName), expr);
                      } else {
                        if (!commentedBindings.has(binding)) {
                          commentedBindings.add(binding);
                          binding.constantViolations.forEach(path =>
                            path
                              .getFunctionParent()
                              .addComment(
                                'leading',
                                ` bailout: mutates ${generate(expr).code}`,
                                '\n'
                              )
                          );
                        }

                        return t.objectMethod(
                          'get',
                          t.identifier(exportName),
                          [],
                          t.blockStatement([t.returnStatement(expr)])
                        );
                      }
                    })
                    .filter(property => property !== null)
                )
              )
            ])
          );
        }

        return;
      }

      match = name.match(EXPORT_RE);

      if (match && !path.scope.hasBinding(name) && !addedExports.has(name)) {
        let id = Number(match[1]);
        let exportName = match[2];
        let node = replaceExportNode(id, exportName, path);

        addedExports.add(name);

        if (node !== undefined) {
          path.replaceWith(node);
        }
      }
    }
  });

  return generate(ast, code).code;
};

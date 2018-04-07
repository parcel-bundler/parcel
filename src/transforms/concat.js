const babylon = require('babylon');
const t = require('babel-types');
const traverse = require('babel-traverse').default;
const generate = require('babel-generator').default;

const EXPORTS_RE = /^\$([\d]+)\$exports$/;
const EXPORT_RE = /^\$([\d]+)\$export\$(.+)$/;

// TODO: minify
// TODO: source-map

module.exports = (code, exports, moduleMap) => {
  const ast = babylon.parse(code);
  let replacements = {};
  let aliases = {};
  let addedExports = new Set();

  let resolveModule = (id, name) => moduleMap.get(id)[name];

  traverse(ast, {
    CallExpression(path) {
      let {arguments: args, callee} = path.node;

      if (!t.isIdentifier(callee)) {
        return;
      }

      if (callee.name === '$parcel$expand_exports') {
        let [id, source] = args;

        if (
          args.length !== 2 ||
          !t.isNumericLiteral(id) ||
          !t.isStringLiteral(source)
        ) {
          throw new Error(
            'invariant: invalid signature, expected : $parcel$expand_exports(number, string)'
          );
        }

        let sourceId = resolveModule(id.value, source.value);

        if (typeof sourceId === 'undefined') {
          throw new Error(`Cannot find module "${source.value}"`);
        }

        let alias = aliases[id.value] || (aliases[id.value] = new Set());

        alias.add(sourceId);
        path.remove();
      } else if (callee.name === '$parcel$require') {
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
    Identifier(path) {
      let {name} = path.node;

      if (typeof name !== 'string') {
        return;
      }

      if (replacements.hasOwnProperty(name)) {
        path.replaceWith(t.identifier(replacements[name]));

        return;
      }

      let match = name.match(EXPORTS_RE);

      if (match) {
        let id = Number(match[1]);
        let alias = aliases[id];

        if (!path.scope.hasBinding(name) && !addedExports.has(name)) {
          let {bindings} = path.scope;

          addedExports.add(name);
          path.getStatementParent().insertBefore(
            t.variableDeclaration('var', [
              t.variableDeclarator(
                t.identifier(name),
                t.objectExpression(
                  Object.keys(bindings)
                    .map(key => {
                      let match = key.match(EXPORT_RE);

                      if (!match) {
                        return null;
                      }

                      let matchedId = Number(match[1]);

                      if (
                        matchedId !== id &&
                        (!alias || !alias.has(matchedId))
                      ) {
                        return null;
                      }

                      let binding = bindings[key];
                      let exportName = t.identifier(match[2]);

                      if (binding.constant) {
                        return t.objectProperty(exportName, t.identifier(key));
                      } else {
                        return t.objectMethod(
                          'get',
                          exportName,
                          [],
                          t.blockStatement([
                            t.returnStatement(t.identifier(key))
                          ])
                        );
                      }
                    })
                    .filter(property => property !== null)
                )
              )
            ])
          );
        }
      }
    }
  });

  return generate(ast, code).code;
};

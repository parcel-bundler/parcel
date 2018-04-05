const babylon = require('babylon');
const t = require('babel-types');
const traverse = require('babel-traverse').default;
const generate = require('babel-generator').default;

// TODO: minify
// TODO: source-map
module.exports = (code, exports) => {
  const ast = babylon.parse(code);
  let replacements = {};

  traverse(ast, {
    // TODO: not optimal
    enter(path) {
      path.traverse({
        CallExpression(path) {
          let {arguments: args, callee} = path.node;

          if (
            t.isIdentifier(callee) &&
            callee.name === '$parcel$expand_exports'
          ) {
            let [from, to] = args;

            if (
              args.length !== 2 ||
              !t.isNumericLiteral(from) ||
              !t.isNumericLiteral(to)
            ) {
              throw new Error(
                'invariant: $parcel$expand_exports takes two number arguments'
              );
            }

            const names = exports.get(from.value);

            // TODO: commonjs
            if (!names) {
              throw new Error(`Cannot find module ${to.value} exports`);
            }

            // TODO: use path.scope.rename
            names.forEach(name => {
              const prev = `$${to.value}$export$${name}`;
              const next = `$${from.value}$export$${name}`;

              replacements[prev] = next;
            });

            path.remove();
          }
        }
      });
    },
    Identifier(path) {
      let {name} = path.node;

      if (name in replacements) {
        path.replaceWith(t.identifier(replacements[name]));
      }
    }
  });

  return generate(ast, code).code;
};

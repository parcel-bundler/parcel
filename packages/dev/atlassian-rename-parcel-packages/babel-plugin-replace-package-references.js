const {shouldReplace, getReplacementName} = require('./utils');

module.exports = function replaceReferences({types: t}) {
  return {
    name: 'replaceReferences',
    visitor: {
      StringLiteral(path) {
        const value = path.node.value;
        if (shouldReplace(value)) {
          path.node.value = getReplacementName(value);
        }
      },
      TemplateLiteral(path) {
        for (const [i, quasi] of path.node.quasis.entries()) {
          if (
            typeof quasi.value.raw === 'string' &&
            quasi.value.raw === quasi.value.cooked &&
            shouldReplace(quasi.value.raw)
          ) {
            const replacement = getReplacementName(quasi.value.raw);
            path.node.quasis[i] = t.templateElement({
              raw: replacement,
              cooked: replacement,
            });
          }
        }
      },
    },
  };
};

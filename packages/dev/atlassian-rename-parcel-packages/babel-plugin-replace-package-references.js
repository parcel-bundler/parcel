const {shouldReplace, getReplacementName} = require('./utils');

module.exports = function replaceReferences() {
  return {
    name: 'replaceReferences',
    visitor: {
      StringLiteral(path) {
        const value = path.node.value;
        if (shouldReplace(value)) {
          path.node.value = getReplacementName(value);
        }
      },
    },
  };
};

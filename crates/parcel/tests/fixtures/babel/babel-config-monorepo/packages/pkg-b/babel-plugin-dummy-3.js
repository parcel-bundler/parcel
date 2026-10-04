module.exports = () => {
  return {
    visitor: {
      StringLiteral(path, state) {
        const opts = state.opts;

        if (path.node.value === 'ANOTHER_THING_TO_REPLACE') {
          path.node.value = 'string from a plugin from a different sub-package';
        }
      }
    }
  };
};

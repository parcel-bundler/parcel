module.exports = () => {
  return {
    visitor: {
      StringLiteral(path, state) {
        const opts = state.opts;

        if (path.node.value === 'REPLACE_ME') {
          path.node.value = 'string from a plugin in babel.config.json';
        }
      }
    }
  };
};

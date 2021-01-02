module.exports = (opts = {}) => {
  return {
    postcssPlugin: 'postcss-test',
    Once(root, {result}) {
      root.walkRules((rule) => {
        rule.each((decl) => {
          if (decl.value === 'red') {
            decl.value = 'green';
          }
        });
      });
    },
  };
};
module.exports.postcss = true;

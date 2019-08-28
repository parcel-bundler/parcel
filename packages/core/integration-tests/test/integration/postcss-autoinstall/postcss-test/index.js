const postcss = require('postcss');

module.exports = postcss.plugin('postcss-test', () => (css, result) => {
  css.walkRules(rule => {
    rule.each(decl => {
      if (decl.value === 'red') {
        decl.value = 'green';
      }
    });
  });
});

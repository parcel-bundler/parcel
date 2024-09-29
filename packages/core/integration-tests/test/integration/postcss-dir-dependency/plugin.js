module.exports = (opts = {}) => {
  const glob = require('fast-glob');
  const fs = require('fs');

  return {
    postcssPlugin: 'postcss-test',
    Once(root, {result}) {
      root.walkRules((rule) => {
        rule.each((decl) => {
          if (decl.value === 'bg-glob') {
            decl.value = glob.sync(__dirname + '/backgrounds/*.txt').sort().map(f => fs.readFileSync(f)).join(', ');
            result.messages.push({
              type: 'dir-dependency',
              dir: __dirname + '/backgrounds',
              glob: '*.txt'
            });
          }
        });
      });
    },
  };
};
module.exports.postcss = true;

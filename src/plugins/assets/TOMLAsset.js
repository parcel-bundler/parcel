const toml = require('toml');
const serializeObject = require('../../utils/serializeObject');

const TOMLAsset = {
  type: 'js',

  parse(code) {
    return toml.parse(code);
  },

  generate(ast, state) {
    return {
      js: serializeObject(ast, state.options.minify)
    };
  }
};

module.exports = {
  Asset: {
    toml: TOMLAsset
  }
};

const yaml = require('js-yaml');
const serializeObject = require('../../utils/serializeObject');

const YAMLAsset = {
  type: 'js',

  parse(code) {
    return yaml.safeLoad(code);
  },

  generate(ast, state) {
    return {
      js: serializeObject(ast, state.options.minify)
    };
  }
};

module.exports = {
  Asset: {
    yaml: YAMLAsset,
    yml: YAMLAsset
  }
};

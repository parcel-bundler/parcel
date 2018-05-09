const path = require('path');
const json5 = require('json5');
const {minify} = require('uglify-es');

const JSONAsset = {
  type: 'js',

  parse(code, state) {
    return path.extname(state.name) === '.json5' ? json5.parse(code) : null;
  },

  generate(ast, state) {
    let code = `module.exports = ${
      ast ? JSON.stringify(ast, null, 2) : state.contents
    };`;

    if (state.options.minify) {
      let minified = minify(code);
      if (minified.error) {
        throw minified.error;
      }

      code = minified.code;
    }

    return {
      js: code
    };
  }
};

module.exports = {
  Asset: {
    json: JSONAsset,
    json5: JSONAsset
  }
};

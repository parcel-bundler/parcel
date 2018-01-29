const Asset = require('../Asset');
const yaml = require('js-yaml');
const {minify} = require('uglify-es');
const {serialize} = require('serialize-to-js');

class YAMLAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
  }

  parse(code) {
    return yaml.safeLoad(code);
  }

  generate() {
    let code = `module.exports = ${serialize(this.ast)};`;

    if (this.options.minify) {
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
}

module.exports = YAMLAsset;

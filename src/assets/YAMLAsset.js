const Asset = require('../Asset');
const yaml = require('js-yaml');
const {minify} = require('uglify-es');

class YAMLAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
  }

  parse(code) {
    return yaml.safeLoad(code);
  }

  generate() {
    let code = `module.exports = ${JSON.stringify(this.ast, false, 2)};`;

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

const Asset = require('../Asset');
const {minify} = require('uglify-es');

class JSONAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
  }

  generate() {
    let code = `module.exports = ${this.contents};`;

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

module.exports = JSONAsset;

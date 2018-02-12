const Asset = require('../Asset');
const path = require('path');
const json5 = require('json5');
const {minify} = require('uglify-es');

class JSONAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
  }

  parse(code) {
    return path.extname(this.name) === '.json5' ? json5.parse(code) : null;
  }

  generate() {
    let code = `module.exports = ${
      this.ast ? JSON.stringify(this.ast, null, 2) : this.contents
    };`;

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

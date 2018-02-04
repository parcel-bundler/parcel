const Asset = require('../Asset');
const toml = require('toml');

class TOMLAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
  }

  parse(code) {
    return toml.parse(code);
  }

  generate() {
    return {
      js: `module.exports=${JSON.stringify(this.ast, false, 2)};`
    };
  }
}

module.exports = TOMLAsset;

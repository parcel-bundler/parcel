const {Asset} = require('@parcel/core');
const toml = require('toml');
const serializeObject = require('@parcel/utils/serializeObject');

class TOMLAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
  }

  parse(code) {
    return toml.parse(code);
  }

  generate() {
    return serializeObject(
      this.ast,
      this.options.minify && !this.options.scopeHoist
    );
  }
}

module.exports = TOMLAsset;

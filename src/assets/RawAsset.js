const Asset = require('../Asset');
const path = require('path');

class RawAsset extends Asset {
  // Don't load raw assets. They will be copied by the RawPackager directly.
  load() {}

  generate() {
    const pathToAsset = JSON.stringify(
      `${this.options.publicURL}${this.generateBundleName()}`
    );
    return {
      js: `module.exports=${pathToAsset};`
    };
  }
}

module.exports = RawAsset;

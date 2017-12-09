const Asset = require('../Asset');

class RawAsset extends Asset {
  // Don't load raw assets. They will be copied by the RawPackager directly.
  load() {}

  generate() {
    return {
      js: `module.exports=${JSON.stringify(this.generateBundleName())};`
    };
  }
}

module.exports = RawAsset;

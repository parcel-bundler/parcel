const Asset = require('../Asset');
const url = require('url');

class RawAsset extends Asset {
  // Don't load raw assets. They will be copied by the RawPackager directly.
  load() {}

  generate() {
    const pathToAsset = JSON.stringify(
      url.resolve(this.options.publicURL, this.generateBundleName())
    );
    return {
      js: `module.exports=${pathToAsset};`
    };
  }
}

module.exports = RawAsset;

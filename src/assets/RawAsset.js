const Asset = require('../Asset');
const urlJoin = require('../utils/urlJoin');

class RawAsset extends Asset {
  // Don't load raw assets. They will be copied by the RawPackager directly.
  load() {}

  generate() {
    const pathToAsset = urlJoin(
      this.options.publicURL,
      this.generateBundleName()
    );

    return {
      js: `module.exports=${JSON.stringify(pathToAsset)};`
    };
  }
}

module.exports = RawAsset;

const Asset = require('../Asset');
const urlJoin = require('../utils/urlJoin');

class RawAsset extends Asset {
  // Don't load raw assets. They will be copied by the RawPackager directly.
  load() {}

  generate() {
    // Don't return a URL to the JS bundle if there is a bundle loader defined for this asset type.
    // This will cause the actual asset to be automatically preloaded prior to the JS bundle running.
    if (this.options.bundleLoaders[this.type]) {
      return {};
    }

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

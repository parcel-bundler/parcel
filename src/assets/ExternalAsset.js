const Asset = require('../Asset');

class ExternalAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
  }

  // Don't load external assets.
  load() {}

  generate() {
    // Don't return a URL to the JS bundle if there is a bundle loader defined for this asset type.
    // This will cause the actual asset to be automatically preloaded prior to the JS bundle running.
    if (this.options.bundleLoaders[this.type]) {
      return {};
    }

    const external = JSON.parse(this.name.slice('external://'.length));

    return {
      js: `module.exports=${external};//external`
    };
  }
}

module.exports = ExternalAsset;

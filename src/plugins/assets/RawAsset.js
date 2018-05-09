const urlJoin = require('../../utils/urlJoin');
const md5 = require('../../utils/md5');

const RawAsset = {
  // Don't load raw assets. They will be copied by the RawPackager directly.
  load() {},

  parse(code, state) {
    return urlJoin(state.options.publicURL, state.generateBundleName());
  },

  generate(path, state) {
    // Don't return a URL to the JS bundle if there is a bundle loader defined for this asset type.
    // This will cause the actual asset to be automatically preloaded prior to the JS bundle running.
    if (state.options.bundleLoaders[state.type]) {
      return {};
    }

    return {
      js: `module.exports=${JSON.stringify(path)};`
    };
  },

  async generateHash(state) {
    return await md5.file(state.name);
  }
};

module.exports = {
  Asset: {
    'internal/raw': RawAsset
  }
};

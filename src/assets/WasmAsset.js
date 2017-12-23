const RawAsset = require('./RawAsset');
const path = require('path');

class WasmAsset extends RawAsset {
  // Don't load raw assets. They will be copied by the RawPackager directly.
  load() {}

  generate(pathToAsset) {
    pathToAsset =
      pathToAsset ||
      JSON.stringify(
        path.join(this.options.publicURL, this.generateBundleName())
      );
    return {
      js: `module.exports=${pathToAsset};`
    };
  }
}

module.exports = WasmAsset;

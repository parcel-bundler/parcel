const Packager = require('./Packager');
const fs = require('../utils/fs');

class RawPackager extends Packager {
  // Override so we don't create a file for this bundle.
  // Each asset will be emitted as a separate file instead.
  setup() {}

  async addAsset(asset) {
    let contents = asset.generated[asset.type];
    if (!contents || (contents && contents.path)) {
      contents = await fs.readFile(contents ? contents.path : asset.name);
    }

    this.size = contents.length;
    await fs.writeFile(this.bundle.name, contents);
  }

  getSize() {
    return this.size || 0;
  }

  end() {}
}

module.exports = RawPackager;

const Packager = require('./Packager');
const path = require('path');
const fs = require('../utils/fs');

class RawPackager extends Packager {
  static shouldAddAsset() {
    // We cannot combine multiple raw assets together - they should be written as separate bundles.
    return false;
  }

  // Override so we don't create a file for this bundle.
  // Each asset will be emitted as a separate file instead.
  setup() {}

  async addAsset(asset) {
    let contents = asset.generated[this.bundle.type];
    if (!contents || (contents && contents.path)) {
      contents = await fs.readFile(contents ? contents.path : asset.name);
    }

    // Create sub-directories if needed
    if (this.bundle.name.includes(path.sep)) {
      await fs.mkdirp(path.dirname(this.bundle.name));
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

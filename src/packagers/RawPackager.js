const Packager = require('./Packager');
const fs = require('../utils/fs');
const path = require('path');
const url = require('url');

class RawPackager extends Packager {
  // Override so we don't create a file for this bundle.
  // Each asset will be emitted as a separate file instead.
  setup() {}

  async addAsset(asset) {
    // Use the bundle name if this is the entry asset, otherwise generate one.
    let name = this.bundle.name;
    if (asset !== this.bundle.entryAsset) {
      name = url.resolve(
        path.join(path.dirname(this.bundle.name), asset.generateBundleName()),
        ''
      );
    }

    let contents = asset.generated[asset.type];
    if (!contents || (contents && contents.path)) {
      contents = await fs.readFile(contents ? contents.path : asset.name);
    }

    this.size = contents.length;
    await fs.writeFile(name, contents);
  }

  getSize() {
    return this.size || 0;
  }

  end() {}
}

module.exports = RawPackager;

const Packager = require('./Packager');
const md5 = require('../utils/md5');
const fs = require('../utils/fs');
const path = require('path');

class RawPackager extends Packager {
  // Override so we don't create a file for this bundle.
  // Each asset will be emitted as a separate file instead.
  setup() {}

  async addAsset(asset) {
    let name = path.join(path.dirname(this.bundle.name), md5(asset.name) + path.extname(asset.name));
    let contents = asset.generated.raw || await fs.readFile(asset.name);
    await fs.writeFile(name, contents);
  }

  end() {}
}

module.exports = RawPackager;

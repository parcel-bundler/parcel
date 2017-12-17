const Packager = require('./Packager');

class WebManifestPackager extends Packager {
  async addAsset(asset) {
    let webmanifest = asset.generated || '';
    await this.dest.write(webmanifest);
  }
}

module.exports = WebManifestPackager;

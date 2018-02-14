const path = require('path');
const Packager = require('./Packager');
const SourceMap = require('../SourceMap');

class SourceMapPackager extends Packager {
  async start() {
    this.sourceMap = new SourceMap();
  }

  async addAsset(asset) {
    await this.sourceMap.addMap(
      asset.generated.map,
      this.bundle.parentBundle.getOffset(asset)
    );
  }

  async end() {
    let file = path.basename(this.bundle.name);
    await this.dest.write(this.sourceMap.stringify(file));
    await super.end();
  }
}

module.exports = SourceMapPackager;

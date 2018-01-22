const path = require('path');
const Packager = require('./Packager');
const SourceMap = require('../SourceMap');

class SourceMapPackager extends Packager {
  async start() {
    this.sourceMap = new SourceMap();
  }

  getOffsets(asset) {
    let parent = this.bundle.parentBundle;
    return parent.offsets.get(asset.relativeName) || {line: 0, column: 0};
  }

  async addAsset(asset) {
    await this.sourceMap.addMap(
      asset.generated.map,
      this.getOffsets(asset).line
    );
  }

  async end() {
    let file = path.basename(this.bundle.name);
    await this.dest.write(this.sourceMap.stringify(file));
    await super.end();
  }
}

module.exports = SourceMapPackager;

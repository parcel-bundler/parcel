const path = require('path');
const Packager = require('./Packager');
const SourceMap = require('../SourceMap');

class SourcemapPackager extends Packager {
  async start() {
    this.sourcemap = new SourceMap(path.basename(this.bundle.name));
  }

  getOffsets(asset) {
    let parent = this.bundle.parentBundle;
    return parent.offsets.get(asset.relativename) || {line: 0, column: 0};
  }

  async addAsset(asset) {
    this.sourcemap.addMap(asset.generated.map, this.getOffsets(asset).line);
  }

  async end() {
    await this.dest.write(this.sourcemap.stringify());
    await super.end();
  }
}

module.exports = SourcemapPackager;

const path = require('path');
const sourceMap = require('source-map');
const Packager = require('./Packager');
const sourceMapUtils = require('../utils/SourceMaps');

class SourcemapPackager extends Packager {
  async start() {
    this.generator = new sourceMap.SourceMapGenerator({
      file: path.basename(this.bundle.name)
    });
  }

  getOffsets(asset) {
    let parent = this.bundle.parentBundle;
    return parent.offsets.get(asset.relativename) || {line: 0, column: 0};
  }

  async addAsset(asset) {
    this.generator = sourceMapUtils.combineSourceMaps(
      asset.generated.map,
      this.generator,
      this.getOffsets(asset).line
    );
  }

  async writeMap() {
    await this.dest.write(this.generator.toString());
  }

  async end() {
    await this.writeMap();
    await super.end();
  }
}

module.exports = SourcemapPackager;

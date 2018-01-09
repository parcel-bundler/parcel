const path = require('path');
const sourceMap = require('source-map');
const Packager = require('./Packager');
const lineCounter = require('../utils/lineCounter');
const sourceMapUtils = require('../utils/SourceMaps');

class SourcemapPackager extends Packager {
  async start() {
    this.generator = new sourceMap.SourceMapGenerator({
      file: path.basename(this.bundle.name)
    });
    this.lineOffset = 72;
  }

  async addAsset(asset) {
    if (asset.generated.map) {
      this.generator = sourceMapUtils.combineSourceMaps(
        asset.generated.map,
        this.generator,
        this.lineOffset
      );
    }
    this.lineOffset += lineCounter(asset.generated[asset.type] + 1);
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

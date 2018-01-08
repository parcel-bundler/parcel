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
    this.lineOffset = 0;
  }

  async addAsset(asset) {
    this.lineOffset =
      (this.lineOffset !== 0 ? this.lineOffset : this.getOffset(asset)) + 1;
    if (asset.generated.map) {
      console.log('map: ' + asset.basename + '\n');
      this.generator = sourceMapUtils.combineSourceMaps(
        asset.generated.map,
        this.generator
      );
    }
    this.lineOffset += lineCounter(asset.generated[asset.type] + 1);
  }

  getOffset(asset) {
    let sibling = this.bundle.getParents().find(value => {
      return value.type === asset.type;
    });
    return sibling ? sibling.lineOffset : 0 || 0;
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

const path = require('path');
const sourceMap = require('source-map');
const Packager = require('./Packager');
const sourceMapUtils = require('../utils/SourceMaps');

class SourcemapPackager extends Packager {
  async start() {
    this.generator = new sourceMap.SourceMapGenerator({
      file: path.basename(this.bundle.name)
    });
    this.rawNodeData = {
      sources: {},
      mappings: []
    };
  }

  getOffsets(asset) {
    let parent = this.bundle.parentBundle;
    return parent.offsets.get(asset.relativename) || {line: 0, column: 0};
  }

  async addAsset(asset) {
    this.nodes = sourceMapUtils.addNodes(
      asset.generated.map,
      this.rawNodeData,
      this.getOffsets(asset).line
    );
  }

  async writeMap() {
    this.rawNodeData.mappings.forEach(mapping => {
      this.generator.addMapping(mapping);
    });
    Object.keys(this.rawNodeData.sources).forEach(sourceName => {
      this.generator.setSourceContent(
        sourceName,
        this.rawNodeData.sources[sourceName]
      );
    });
    await this.dest.write(this.generator.toString());
  }

  async end() {
    await this.writeMap();
    await super.end();
  }
}

module.exports = SourcemapPackager;

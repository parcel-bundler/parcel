const path = require('path');
const Packager = require('./Packager');
const SourceMap = require('../SourceMap');

class SourceMapPackager extends Packager {
  async start() {
    this.sourceMap = new SourceMap();
  }

  async addAsset(asset) {
    let offsets = this.bundle.parentBundle.getOffset(asset);
    await this.sourceMap.addMap(asset.generated.map, offsets[0], offsets[1]);
  }

  async end() {
    let file = path.basename(this.bundle.parentBundle.name);

    await this.write(
      this.sourceMap.stringify(
        file,
        path.relative(this.options.outDir, this.options.rootDir)
      )
    );
    await super.end();
  }
}

module.exports = SourceMapPackager;

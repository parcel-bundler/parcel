const fs = require('fs');
const path = require('path');
const Packager = require('./Packager');
const promisify = require('../utils/promisify');
const sourceMap = require('source-map');

class SourcemapPackager extends Packager {
  setup() {
    this.location = this.bundle.name + '.map';
    this.dest = fs.createWriteStream(this.bundle.name);
    this.dest.write = promisify(this.dest.write.bind(this.dest));
    this.dest.end = promisify(this.dest.end.bind(this.dest));

    this.generator = new sourceMap.SourceMapGenerator({
      file: path.basename(this.bundle.name)
    });
  }

  async addAsset(asset) {
    if (asset.generated.map) {
      await this.addMap(asset.generated.map);
    }
  }

  async addMap(map) {
    let inputMapConsumer = map.computeColumnSpans
      ? map
      : new sourceMap.SourceMapConsumer(map);
    let addedSources = {};

    // Add all mappings from asset to bundle
    inputMapConsumer.eachMapping(mapping => {
      if (!mapping.source || !mapping.originalLine || !mapping.originalColumn) {
        return false;
      }
      // TODO: calculate offset based on bundle
      let lineOffset = 0;

      this.generator.addMapping({
        source: mapping.source,
        original: {
          line: mapping.originalLine,
          column: mapping.originalColumn
        },
        generated: {
          line: mapping.generatedLine + lineOffset,
          column: mapping.generatedColumn
        },
        name: mapping.name
      });
      if (!addedSources[mapping.source]) {
        let content = inputMapConsumer.sourceContentFor(mapping.source, true);
        if (content) {
          this.generator.setSourceContent(mapping.source, content);
          addedSources[mapping.source] = true;
        }
      }
    });
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

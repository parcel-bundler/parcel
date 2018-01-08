const fs = require('fs');
const path = require('path');
const Packager = require('./Packager');
const promisify = require('../utils/promisify');
const urlJoin = require('../utils/urlJoin');
const sourceMap = require('source-map');

class SourcemapPackager extends Packager {
  setup() {
    this.location = this.bundle.name + '.map';
    this.dest = fs.createWriteStream(this.location);
    this.dest.write = promisify(this.dest.write.bind(this.dest));
    this.dest.end = promisify(this.dest.end.bind(this.dest));

    this.generator = new sourceMap.SourceMapGenerator({
      file: path.basename(this.bundle.name)
    });
    this.url = urlJoin(this.options.publicURL, path.basename(this.location));
  }

  async addAsset(asset) {
    if (asset.generated.map) {
      try {
        await this.addMap(asset.generated.map);
      } catch (e) {
        // console.log(e);
      }
    }
  }

  async addMap(map) {
    const inputMapConsumer = new sourceMap.SourceMapConsumer(map);
    let addedSources = {};

    // Add all mappings from asset to bundle
    inputMapConsumer.eachMapping(mapping => {
      if (!mapping.source) {
        return false;
      }
      let newMapping = {
        source: mapping.source,
        original: {
          line: mapping.originalLine,
          column: mapping.originalColumn
        },
        generated: {
          line: mapping.generatedLine,
          column: mapping.generatedColumn
        },
        name: mapping.name
      };
      this.generator.addMapping(newMapping);
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

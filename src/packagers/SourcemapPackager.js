const fs = require('fs');
const path = require('path');
const Packager = require('./Packager');
const promisify = require('../utils/promisify');
const urlJoin = require('../utils/urlJoin');

class SourcemapPackager extends Packager {
  setup() {
    this.location = this.bundle.name + '.map';
    this.dest = fs.createWriteStream(this.location);
    this.dest.write = promisify(this.dest.write.bind(this.dest));
    this.dest.end = promisify(this.dest.end.bind(this.dest));

    this.sourcemap = {
      version: 3,
      sources: [],
      file: path.basename(this.bundle.name),
      names: [],
      mappings: '',
      sourcesContent: []
    };
    this.mapCount = 0;
    this.url = urlJoin(this.options.publicURL, path.basename(this.location));
  }

  async addAsset(asset) {
    if (asset.generated.map) {
      await this.addMap(asset.generated.map);
      this.mapCount++;
    }
  }

  async addMap(map) {
    if (map.version !== 3) {
      throw new Error('Only sourcemap v3 is supported.');
    }
    let sm = this.sourcemap;
    sm.names = sm.names.concat(map.names);
    sm.sources = sm.sources.concat(map.sources);
    sm.sourcesContent = sm.sourcesContent.concat(map.sourcesContent);
    sm.mappings += (sm.mappings.length > 0 ? ';' : '') + map.mappings;
  }

  async writeMap() {
    await this.dest.write(JSON.stringify(this.sourcemap));
  }

  async end() {
    await this.writeMap();
    await super.end();
  }
}

module.exports = SourcemapPackager;

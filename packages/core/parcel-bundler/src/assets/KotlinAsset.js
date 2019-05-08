const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const path = require('path');
const fs = require('@parcel/fs');
const os = require('os');

class KotlinAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
  }

  async generate() {
    // require kotlin
    const kotlinCompiler = await localRequire(
      '@jetbrains/kotlinc-js-api',
      this.name
    );

    let id = Math.random()
      .toString(36)
      .slice(3);
    let dir = path.join(os.tmpdir(), id);
    let filename = path.join(dir, id + '.js');

    await fs.mkdirp(dir);

    await kotlinCompiler.compile({
      output: filename,
      sources: [this.name],
      moduleKind: 'commonjs',
      noStdlib: false,
      metaInfo: true,
      sourceMaps: this.options.sourceMaps
    });

    let source = await fs.readFile(filename, 'utf8');
    let sourceMap;
    if (this.options.sourceMaps) {
      sourceMap = await fs.readFile(filename + '.map', 'utf8');

      sourceMap = JSON.parse(sourceMap);
      sourceMap.sources = [this.relativeName];
      sourceMap.sourcesContent = [this.contents];

      // remove source map url
      source = source.substring(0, source.lastIndexOf('//# sourceMappingURL'));
    }

    // delete temp directory
    await fs.rimraf(dir);

    return [
      {
        type: 'js',
        value: source,
        sourceMap
      }
    ];
  }
}

module.exports = KotlinAsset;

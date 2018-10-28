const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');

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
    const fs = require('fs', this.name);

    // remove extension
    let fileName = this.id.substring(0, this.id.lastIndexOf('.'));

    await kotlinCompiler.compile({
      output: 'build/kt.temp/' + fileName + '.js',
      sources: [this.name],
      moduleKind: 'commonjs',
      noStdlib: false,
      metaInfo: false,
      sourceMaps: this.options.sourceMaps
    });

    let source = fs.readFileSync('build/kt.temp/' + fileName + '.js', 'utf8');
    let sourceMap;
    if (this.options.sourceMaps) {
      sourceMap = fs.readFileSync(
        'build/kt.temp/' + fileName + '.js.map',
        'utf8'
      );

      sourceMap = JSON.parse(sourceMap);
      sourceMap.sources = [this.relativeName];
      sourceMap.sourcesContent = [this.contents];

      // remove source map url
      source = source.substring(0, source.lastIndexOf('//# sourceMappingURL'));
    }

    // delete old files
    fs.unlinkSync('build/kt.temp/' + fileName + '.js');
    fs.unlinkSync('build/kt.temp/' + fileName + '.js.map');
    if (fs.readdirSync('build/kt.temp').length === 0)
      fs.rmdirSync('build/kt.temp'); // Remove kt.temp directory if it is empty
    if (fs.readdirSync('build').length === 0) fs.rmdirSync('build'); // Remove build directory if it is empty

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

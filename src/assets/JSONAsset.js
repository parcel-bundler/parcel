const JSAsset = require('./JSAsset');
const {minify} = require('uglify-es');

class JSONAsset extends JSAsset {
  async load() {
    return 'module.exports = ' + (await super.load()) + ';';
  }

  parse() {}
  collectDependencies() {}
  pretransform() {}
  async transform() {
    if (this.options.minify) {
      this.contents = minify(this.contents, {
        compress: {
          expression: true
        }
      }).code;
    }
  }
}

module.exports = JSONAsset;

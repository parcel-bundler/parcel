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
      let minified = minify(this.contents, {
        compress: {
          expression: true
        }
      });
      if (minified.error) {
        throw minified.error;
      }
      this.contents = minified.code;
    }
  }
}

module.exports = JSONAsset;

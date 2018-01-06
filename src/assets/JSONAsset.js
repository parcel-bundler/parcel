const JSAsset = require('./JSAsset');
const uglify = require('../transforms/uglify');

class JSONAsset extends JSAsset {
  async load() {
    return 'module.exports = ' + (await super.load()) + ';';
  }

  parse() {}
  collectDependencies() {}
  pretransform() {}
  async transform() {
    if (this.options.minify) {
      await uglify(this);
    }
  }
}

module.exports = JSONAsset;

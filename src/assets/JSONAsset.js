const JSAsset = require('./JSAsset');

class JSONAsset extends JSAsset {
  async load() {
    return (
      'module.exports = ' + (await JSAsset.prototype.load.call(this)) + ';'
    );
  }

  parse() {}
  collectDependencies() {}
  pretransform() {}
  transform() {}
}

module.exports = JSONAsset;

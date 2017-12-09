const JSAsset = require('./JSAsset');

class JSONAsset extends JSAsset {
  async load() {
    return 'module.exports = ' + (await super.load()) + ';';
  }

  parse() {}
  collectDependencies() {}
  pretransform() {}
  transform() {}
}

module.exports = JSONAsset;

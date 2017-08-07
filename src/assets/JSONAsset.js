const JSAsset = require('./JSAsset');

class JSONAsset extends JSAsset {
  async load() {
    return 'module.exports = ' + await super.load() + ';';
  }

  parse() {
    // do nothing
  }

  collectDependencies() {}
}

module.exports = JSONAsset;

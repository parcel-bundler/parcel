const JSAsset = require('./JSAsset');

class JSONAsset extends JSAsset {
  parse(code) {
    return super.parse('module.exports = ' + code + ';');
  }
}

module.exports = JSONAsset;

const JSAsset = require('./JSAsset');

class JSONAsset extends JSAsset {
  parse(code) {
    super.parse('module.exports = ' + code + ';');
  }
}

module.exports = JSONAsset;

const {Readable} = require('stream');

class CSSPackager extends Readable {
  _read() {}

  addAsset(asset) {
    this.push(asset.contents);
  }

  end() {
    this.push(null);
  }
}

module.exports = CSSPackager;

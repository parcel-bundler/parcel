const {Readable} = require('stream');

class CSSPackager extends Readable {
  _read() {}

  addAsset(asset) {
    this.push(asset.generated.css);
  }

  end() {
    this.push(null);
  }
}

module.exports = CSSPackager;

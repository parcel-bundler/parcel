const Asset = require('../Asset');

class WASMAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'wasm';
    this.encoding = null;
  }

  generate() {
    let js = `
      var buf = new Uint8Array(${JSON.stringify(Array.from(this.contents))});
      var m = new WebAssembly.Module(buf);
      module.exports = new WebAssembly.Instance(m).exports;
    `;

    return {
      wasm: this.contents,
      js
    };
  }
}

module.exports = WASMAsset;

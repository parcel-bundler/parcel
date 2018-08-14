const path = require('path');

let ID = 0;

class Asset {
  constructor(asset, parent) {
    this.id = ID++; // TODO: replace with something deterministic
    this.parentId = parent ? parent.id : null;
    this.env = Object.assign({}, parent && parent.env, asset.env);
    this.type = asset.type || path.extname(asset.filePath).slice(1);
    this.filePath = parent ? parent.filePath.slice(0, -parent.type.length) + this.type : asset.filePath;
    this.code = asset.code;
    this.map = asset.map;
    this.ast = asset.ast;
    this.meta = asset.meta;
    this.dependencies = asset.dependencies || [];
  }
}

module.exports = Asset;

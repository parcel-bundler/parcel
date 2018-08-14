const path = require('path');
const Dependency = require('./Dependency');

let ID = 0;

class Asset {
  constructor(asset, previous) {
    this.id = previous ? previous.id : ID++; // TODO: replace with something deterministic
    this.parentId = previous ? previous.parentId || previous.id : asset.parentId;
    this.env = Object.assign({}, previous && previous.env, asset.env);
    this.type = asset.type || path.extname(asset.filePath).slice(1);
    this.filePath = previous ? previous.filePath.slice(0, -previous.type.length) + this.type : asset.filePath;
    // this.relativePath = path.relative(options.rootDir, this.filePath);
    this.code = asset.code;
    this.map = asset.map;
    this.ast = asset.ast;
    this.meta = asset.meta || {};
    this.dependencies = (asset.dependencies || []).map(dep => toDependency(dep, this))
      .concat((previous ? previous.dependencies : []).map(dep => toDependency(dep, previous)));
  }
}

function toDependency(dep, previous) {
  if (dep instanceof Dependency) {
    return dep;
  }

  return new Dependency(dep, previous)
}

module.exports = Asset;

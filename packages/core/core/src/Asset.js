const path = require('path');
const Dependency = require('./Dependency');

let ID = 0;

class Asset {
  constructor(asset, previous) {
    this.id = previous ? previous.id : ID++; // TODO: replace with something deterministic
    this.parentId = previous
      ? previous.parentId || previous.id
      : asset.parentId;
    this.env = Object.assign({}, previous && previous.env, asset.env);
    this.type = asset.type || path.extname(asset.filePath).slice(1);
    this.filePath = previous
      ? previous.filePath.slice(0, -previous.type.length) + this.type
      : asset.filePath;
    // this.relativePath = path.relative(options.rootDir, this.filePath);
    this.code = asset.code || (asset.blobs ? asset.blobs.code : null);
    this.blobs = asset.blobs || {};
    this.ast = asset.ast;
    this.meta = asset.meta || {};
    this.hash = previous ? previous.hash : null;
    this.dependencies = (asset.dependencies || [])
      .map(dep => toDependency(dep, this))
      .concat(
        (previous ? previous.dependencies : []).map(dep =>
          toDependency(dep, previous)
        )
      );
  }

  toJSON() {
    return {
      id: this.id,
      parentId: this.parentId,
      env: this.env,
      type: this.type,
      filePath: this.filePath,
      blobs: this.blobs,
      meta: this.meta,
      hash: this.hash,
      dependencies: this.dependencies
    };
  }
}

function toDependency(dep, previous) {
  if (dep instanceof Dependency) {
    return dep;
  }

  return new Dependency(dep, previous);
}

module.exports = Asset;

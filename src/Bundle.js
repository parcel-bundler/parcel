const Path = require('path');
const JSPackager = require('./packagers/JSPackager');
const CSSPackager = require('./packagers/CSSPackager');
const fs = require('fs');
const crypto = require('crypto');

const PACKAGERS = {
  js: JSPackager,
  css: CSSPackager
};

class Bundle {
  constructor(type, name, parent) {
    this.type = type;
    this.name = name;
    this.parentBundle = parent;
    this.assets = new Set;
    this.childBundles = new Set;
    this.typeBundleMap = new Map;
  }

  addAsset(asset) {
    asset.bundles.add(this);
    this.assets.add(asset);
  }

  removeAsset(asset) {
    asset.bundles.delete(this);
    this.assets.delete(asset);
  }

  getChildBundle(type) {
    if (type === this.type) {
      return this;
    }

    if (!this.typeBundleMap.has(type)) {
      let bundle = this.createChildBundle(type, Path.join(Path.dirname(this.name), Path.basename(this.name, Path.extname(this.name)) + '.' + type));
      this.typeBundleMap.set(type, bundle);
    }

    return this.typeBundleMap.get(type);
  }

  createChildBundle(type, name) {
    let bundle = new Bundle(type, name, this);
    this.childBundles.add(bundle);
    return bundle;
  }

  get isEmpty() {
    return this.assets.size === 0;
  }

  async package(oldHashes, newHashes = new Map) {
    if (this.isEmpty) {
      return newHashes;
    }

    let hash = this.getHash();
    newHashes.set(this.name, hash);

    if (!oldHashes || oldHashes.get(this.name) !== hash) {
      console.log('bundling', this.name)

      let Packager = PACKAGERS[this.type];
      if (!Packager) {
        throw new Error('Could not find packager for ' + this.type + ' assets.');
      }

      let packager = new Packager;
      packager.pipe(fs.createWriteStream(this.name));

      if (typeof packager.generatePrelude === 'function') {
        packager.generatePrelude(this);
      }

      let included = new Set;
      for (let asset of this.assets) {
        this._addDeps(asset, packager, included)
      }

      packager.end();
    }

    for (let bundle of this.childBundles.values()) {
      await bundle.package(oldHashes, newHashes);
    }

    return newHashes;
  }

  _addDeps(asset, packager, included) {
    if (!this.assets.has(asset) || included.has(asset)) {
      return;
    }

    included.add(asset);

    for (let depAsset of asset.depAssets.values()) {
      this._addDeps(depAsset, packager, included);
    }

    packager.addAsset(asset);
  }

  getParents() {
    let parents = [];
    let bundle = this;

    while (bundle) {
      parents.push(bundle);
      bundle = bundle.parentBundle;
    }

    return parents;
  }

  findCommonAncestor(bundle) {
    // Get a list of parent bundles going up to the root
    let ourParents = this.getParents();
    let theirParents = bundle.getParents();

    // Start from the root bundle, and find the first bundle that's different
    let a = ourParents.pop();
    let b = theirParents.pop();
    let last;
    while (a === b && ourParents.length > 0 && theirParents.length > 0) {
      last = a;
      a = ourParents.pop();
      b = theirParents.pop();
    }

    if (a === b) { // One bundle descended from the other
      return a;
    }

    return last;
  }

  getHash() {
    let hash = crypto.createHash('md5');
    for (let asset of this.assets) {
      hash.update(asset.hash);
    }

    return hash.digest('hex');
  }
}

module.exports = Bundle;

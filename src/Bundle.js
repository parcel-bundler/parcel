const Path = require('path');
const JSPackager = require('./packagers/JSPackager');
const CSSPackager = require('./packagers/CSSPackager');
const fs = require('fs');

const PACKAGERS = {
  js: JSPackager,
  css: CSSPackager
};

class Bundle {
  constructor(type, name) {
    this.type = type;
    this.name = name;
    this.assets = new Set;
    this.childBundles = new Map;
  }

  addAsset(asset) {
    asset.bundle = this;
    this.assets.add(asset);
  }

  removeAsset(asset) {
    asset.bundle = null;
    this.assets.delete(asset);
  }

  getChildBundle(type) {
    if (type === this.type) {
      return this;
    }

    if (!this.childBundles.has(type)) {
      let bundle = new Bundle(type, Path.join(Path.dirname(this.name), Path.basename(this.name, Path.extname(this.name)) + '.' + type));
      this.childBundles.set(type, bundle);
    }

    return this.childBundles.get(type);
  }

  async package() {
    let Packager = PACKAGERS[this.type];
    if (!Packager) {
      throw new Error('Could not find packager for ' + this.type + ' assets.');
    }

    let packager = new Packager;
    packager.pipe(fs.createWriteStream(this.name));

    let included = new Set;
    for (let asset of this.assets) {
      this._addDeps(asset, packager, included)
    }

    packager.end();

    for (let bundle of this.childBundles.values()) {
      await bundle.package();
    }
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
}

module.exports = Bundle;

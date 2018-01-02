const Path = require('path');
const crypto = require('crypto');

/**
 * A Bundle represents an output file, containing multiple assets. Bundles can have
 * child bundles, which are bundles that are loaded dynamically from this bundle.
 * Child bundles are also produced when importing an asset of a different type from
 * the bundle, e.g. importing a CSS file from JS.
 */
class Bundle {
  constructor(type, name, parent) {
    this.type = type;
    this.name = name;
    this.parentBundle = parent;
    this.entryAsset = null;
    this.assets = new Set();
    this.childBundles = new Set();
    this.siblingBundles = new Map();
  }

  addAsset(asset) {
    asset.bundles.add(this);
    this.assets.add(asset);
  }

  removeAsset(asset) {
    asset.bundles.delete(this);
    this.assets.delete(asset);
  }

  getSiblingBundle(type) {
    if (!type || type === this.type) {
      return this;
    }

    if (!this.siblingBundles.has(type)) {
      let bundle = this.createChildBundle(
        type,
        Path.join(
          Path.dirname(this.name),
          Path.basename(this.name, Path.extname(this.name)) + '.' + type
        )
      );
      this.siblingBundles.set(type, bundle);
    }

    return this.siblingBundles.get(type);
  }

  createChildBundle(type, name) {
    let bundle = new Bundle(type, name, this);
    this.childBundles.add(bundle);
    return bundle;
  }

  get isEmpty() {
    return this.assets.size === 0;
  }

  async package(bundler, oldHashes, newHashes = new Map()) {
    if (this.isEmpty) {
      return newHashes;
    }

    let hash = this.getHash();
    newHashes.set(this.name, hash);

    let promises = [];
    if (!oldHashes || oldHashes.get(this.name) !== hash) {
      promises.push(this._package(bundler));
    }

    for (let bundle of this.childBundles.values()) {
      promises.push(bundle.package(bundler, oldHashes, newHashes));
    }

    await Promise.all(promises);
    return newHashes;
  }

  async _package(bundler) {
    let Packager = bundler.packagers.get(this.type);
    let packager = new Packager(this, bundler);

    await packager.start();

    let included = new Set();
    for (let asset of this.assets) {
      await this._addDeps(asset, packager, included);
    }

    await packager.end();
  }

  async _addDeps(asset, packager, included) {
    if (!this.assets.has(asset) || included.has(asset)) {
      return;
    }

    included.add(asset);

    for (let depAsset of asset.depAssets.values()) {
      await this._addDeps(depAsset, packager, included);
    }

    await packager.addAsset(asset);
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

    if (a === b) {
      // One bundle descended from the other
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

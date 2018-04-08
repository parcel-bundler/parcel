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
    this.siblingBundles = new Set();
    this.siblingBundlesMap = new Map();
    this.offsets = new Map();
    this.totalSize = 0;
    this.bundleTime = 0;
  }

  static createWithAsset(asset, parentBundle) {
    let bundle = new Bundle(
      asset.type,
      Path.join(asset.options.outDir, asset.generateBundleName()),
      parentBundle
    );

    bundle.entryAsset = asset;
    bundle.addAsset(asset);
    return bundle;
  }

  addAsset(asset) {
    asset.bundles.add(this);
    this.assets.add(asset);
  }

  removeAsset(asset) {
    asset.bundles.delete(this);
    this.assets.delete(asset);
  }

  addOffset(asset, line) {
    this.offsets.set(asset, line);
  }

  getOffset(asset) {
    return this.offsets.get(asset) || 0;
  }

  getSiblingBundle(type) {
    if (!type || type === this.type) {
      return this;
    }

    if (!this.siblingBundlesMap.has(type)) {
      let bundle = new Bundle(
        type,
        Path.join(
          Path.dirname(this.name),
          Path.basename(this.name, Path.extname(this.name)) + '.' + type
        ),
        this
      );

      this.childBundles.add(bundle);
      this.siblingBundles.add(bundle);
      this.siblingBundlesMap.set(type, bundle);
    }

    return this.siblingBundlesMap.get(type);
  }

  createChildBundle(entryAsset) {
    let bundle = Bundle.createWithAsset(entryAsset, this);
    this.childBundles.add(bundle);
    return bundle;
  }

  createSiblingBundle(entryAsset) {
    let bundle = this.createChildBundle(entryAsset);
    this.siblingBundles.add(bundle);
    return bundle;
  }

  get isEmpty() {
    return this.assets.size === 0;
  }

  getBundleNameMap(contentHash, hashes = new Map()) {
    let hashedName = this.getHashedBundleName(contentHash);
    hashes.set(Path.basename(this.name), hashedName);
    this.name = Path.join(Path.dirname(this.name), hashedName);

    for (let child of this.childBundles.values()) {
      child.getBundleNameMap(contentHash, hashes);
    }

    return hashes;
  }

  getHashedBundleName(contentHash) {
    // If content hashing is enabled, generate a hash from all assets in the bundle.
    // Otherwise, use a hash of the filename so it remains consistent across builds.
    let ext = Path.extname(this.name);
    let hash = (contentHash
      ? this.getHash()
      : Path.basename(this.name, ext)
    ).slice(-8);
    let entryAsset = this.entryAsset || this.parentBundle.entryAsset;
    let name = Path.basename(entryAsset.name, Path.extname(entryAsset.name));
    let isMainEntry = entryAsset.name === entryAsset.options.mainFile;
    let isEntry =
      isMainEntry || Array.from(entryAsset.parentDeps).some(dep => dep.entry);

    // If this is the main entry file, use the output file option as the name if provided.
    if (isMainEntry && entryAsset.options.outFile) {
      name = entryAsset.options.outFile;
    }

    // If this is an entry asset, don't hash. Return a relative path
    // from the main file so we keep the original file paths.
    if (isEntry) {
      return Path.join(
        Path.relative(
          Path.dirname(entryAsset.options.mainFile),
          Path.dirname(entryAsset.name)
        ),
        name + ext
      );
    }

    // If this is an index file, use the parent directory name instead
    // which is probably more descriptive.
    if (name === 'index') {
      name = Path.basename(Path.dirname(entryAsset.name));
    }

    // Add the content hash and extension.
    return name + '.' + hash + ext;
  }

  async package(bundler, oldHashes, newHashes = new Map()) {
    if (this.isEmpty) {
      return newHashes;
    }

    let hash = this.getHash();
    newHashes.set(this.name, hash);

    let promises = [];
    let mappings = [];
    if (!oldHashes || oldHashes.get(this.name) !== hash) {
      promises.push(this._package(bundler));
    }

    for (let bundle of this.childBundles.values()) {
      if (bundle.type === 'map') {
        mappings.push(bundle);
      } else {
        promises.push(bundle.package(bundler, oldHashes, newHashes));
      }
    }

    await Promise.all(promises);
    for (let bundle of mappings) {
      await bundle.package(bundler, oldHashes, newHashes);
    }
    return newHashes;
  }

  async _package(bundler) {
    let Packager = bundler.packagers.get(this.type);
    let packager = new Packager(this, bundler);

    let startTime = Date.now();
    await packager.setup();
    await packager.start();

    let included = new Set();
    for (let asset of this.assets) {
      await this._addDeps(asset, packager, included);
    }

    await packager.end();

    this.bundleTime = Date.now() - startTime;
    for (let asset of this.assets) {
      this.bundleTime += asset.buildTime;
    }
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

    const assetSize = packager.getSize() - this.totalSize;
    if (assetSize > 0) {
      this.addAssetSize(asset, assetSize);
    }
  }

  addAssetSize(asset, size) {
    asset.bundledSize = size;
    this.totalSize += size;
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

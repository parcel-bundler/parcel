const fs = require('./utils/fs');
const Resolver = require('./Resolver');
const Parser = require('./Parser');
const WorkerFarm = require('./WorkerFarm');
const worker = require('./utils/promisify')(require('./worker.js'));
const Path = require('path');
const Bundle = require('./Bundle');
const {FSWatcher} = require('chokidar');
const FSCache = require('./FSCache');
const md5 = require('./utils/md5');

class Bundler {
  constructor(main, options = {}) {
    this.mainFile = main;
    this.options = this.normalizeOptions(options);

    this.resolver = new Resolver(options);
    this.parser = new Parser(options);
    this.cache = this.options.enableCache ? new FSCache(options) : null;

    this.loadedAssets = new Map;
    this.farm = null;
    this.watcher = null;
    this.bundleHashes = null;
  }

  normalizeOptions(options) {
    let isProduction = options.production || process.env.NODE_ENV === 'production';
    return Object.assign(options, {
      outDir: Path.resolve(options.outDir || 'dist'),
      watch: typeof options.watch === 'boolean' ? options.watch : !isProduction,
      enableCache: typeof options.enableCache === 'boolean' ? options.enableCache : true,
      killWorkers: typeof options.killWorkers === 'boolean' ? options.killWorkers : true,
      minify: typeof options.minify === 'boolean' ? options.minify : isProduction
    });
  }

  async bundle() {
    this.farm = WorkerFarm.getShared(this.options);

    if (this.options.watch) {
      this.watcher = new FSWatcher;
      this.watcher.on('change', this.onChange.bind(this));
      this.watcher.on('unlink', this.onUnlink.bind(this));
    }

    try {
      let main = await this.resolveAsset(this.mainFile);
      await this.loadAsset(main);
      this.mainAsset = main;

      await fs.mkdirp(this.options.outDir);

      let bundle = this.createBundleTree(main);
      this.bundleHashes = await bundle.package();

      return bundle;
    } finally {
      if (!this.watcher && this.options.killWorkers) {
        this.farm.end();
      }
    }
  }

  async resolveAsset(name, parent) {
    let {path, pkg} = await this.resolver.resolve(name, parent);
    if (this.loadedAssets.has(path)) {
      return this.loadedAssets.get(path);
    }

    let asset = this.parser.getAsset(path, pkg, this.options);
    this.loadedAssets.set(path, asset);

    if (this.watcher) {
      this.watcher.add(path);
    }

    return asset;
  }

  async loadAsset(asset) {
    if (asset.processed) {
      return;
    }

    // Mark the asset processed so we don't load it twice
    asset.processed = true;

    // First try the cache, otherwise load and compile in the background
    let processed = this.cache && await this.cache.read(asset.name);
    if (!processed) {
      processed = await this.farm.run(asset.name, asset.package, this.options);
      if (this.cache) {
        this.cache.write(asset.name, processed);
      }
    }

    asset.generated = processed.generated;
    asset.hash = processed.hash;

    // Process asset dependencies
    await Promise.all(processed.dependencies.map(async dep => {
      if (dep.includedInParent) {
        // This dependency is already included in the parent's generated output,
        // so no need to load it. We map the name back to the parent asset so
        // that changing it triggers a recompile of the parent.
        this.loadedAssets.set(dep.name, asset);
      } else {
        asset.dependencies.set(dep.name, dep);
        let assetDep = await this.resolveAsset(dep.name, asset.name);
        assetDep.parentDeps.add(dep);
        asset.depAssets.set(dep.name, assetDep);
        await this.loadAsset(assetDep);
      }
    }));
  }

  createBundleTree(asset, dep, bundle) {
    if (asset.parentBundle) {
      // If the asset is already in a bundle, it is shared. Move it to the lowest common ancestor.
      if (asset.parentBundle !== bundle) {
        let commonBundle = bundle.findCommonAncestor(asset.parentBundle);
        if (asset.parentBundle !== commonBundle) {
          this.moveAssetToBundle(asset, commonBundle);
        }
      }

      return;
    }

    // Create the root bundle if it doesn't exist
    if (!bundle) {
      bundle = new Bundle(asset.type, Path.join(this.options.outDir, Path.basename(asset.name, Path.extname(asset.name)) + '.' + asset.type));
      bundle.entryAsset = asset;
    }

    // Create a new bundle for dynamic imports
    if (dep && dep.dynamic) {
      bundle = bundle.createChildBundle(asset.type, Path.join(this.options.outDir, md5(asset.name) + '.' + asset.type));
    }

    asset.parentBundle = bundle;

    // If the asset type does not match the bundle type, create a new child bundle
    if (asset.type !== bundle.type) {
      // If the asset generated a representation for the parent bundle type, also add it there
      if (asset.generated[bundle.type] != null) {
        bundle.addAsset(asset);
      }

      bundle = bundle.getChildBundle(asset.type);
    }

    bundle.addAsset(asset);

    for (let dep of asset.dependencies.values()) {
      let assetDep = asset.depAssets.get(dep.name);
      this.createBundleTree(assetDep, dep, bundle);
    }

    return bundle;
  }

  moveAssetToBundle(asset, commonBundle) {
    for (let bundle of Array.from(asset.bundles)) {
      bundle.removeAsset(asset);
      commonBundle.getChildBundle(bundle.type).addAsset(asset);
    }

    let oldBundle = asset.parentBundle;
    asset.parentBundle = commonBundle;

    // Move all dependencies as well
    for (let child of asset.depAssets.values()) {
      if (child.parentBundle === oldBundle) {
        this.moveAssetToBundle(child, commonBundle);
      }
    }
  }

  async rebundle() {
    for (let asset of this.loadedAssets.values()) {
      asset.invalidateBundle();
    }

    let bundle = this.createBundleTree(this.mainAsset);
    this.bundleHashes = await bundle.package(this.bundleHashes);
    return bundle;
  }

  async onChange(path) {
    console.time('change');
    let asset = this.loadedAssets.get(path);
    if (!asset) {
      return;
    }

    // Invalidate and reload the asset
    asset.invalidate();
    if (this.cache) {
      this.cache.invalidate(asset.name);
    }

    await this.loadAsset(asset, asset.parentBundle);
    await this.rebundle();
    console.timeEnd('change');
  }

  async onUnlink(path) {
    let asset = this.loadedAssets.get(path);
    if (!asset) {
      return;
    }

    this.loadedAssets.delete(path);
    if (this.cache) {
      this.cache.delete(path);
    }

    await this.rebundle();
  }
}

module.exports = Bundler;

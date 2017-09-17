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
const HMRServer = require('./HMRServer');
const Server = require('./Server');
const {EventEmitter} = require('events');

/**
 * The Bundler is the main entry point. It resolves and loads assets,
 * creates the bundle tree, and manages the worker farm, cache, and file watcher.
 */
class Bundler extends EventEmitter {
  constructor(main, options = {}) {
    super();
    this.mainFile = Path.resolve(main || '');
    this.options = this.normalizeOptions(options);

    this.resolver = new Resolver(this.options);
    this.parser = new Parser(this.options);
    this.cache = this.options.cache ? new FSCache(this.options) : null;

    this.pending = true;
    this.loadedAssets = new Map;
    this.farm = null;
    this.watcher = null;
    this.hmr = null;
    this.bundleHashes = null;
  }

  normalizeOptions(options) {
    const isProduction = options.production || process.env.NODE_ENV === 'production';
    const publicURL = options.publicURL || '/' + Path.basename(options.outDir || 'dist');
    const watch = typeof options.watch === 'boolean' ? options.watch : !isProduction;
    return {
      outDir: Path.resolve(options.outDir || 'dist'),
      publicURL: publicURL,
      watch: watch,
      cache: typeof options.cache === 'boolean' ? options.cache : true,
      killWorkers: typeof options.killWorkers === 'boolean' ? options.killWorkers : true,
      minify: typeof options.minify === 'boolean' ? options.minify : isProduction,
      hmr: typeof options.hmr === 'boolean' ? options.hmr : watch
    };
  }

  async bundle() {
    this.pending = true;
    this.farm = WorkerFarm.getShared(this.options);

    if (this.options.watch) {
      this.watcher = new FSWatcher;
      this.watcher.on('change', this.onChange.bind(this));
      this.watcher.on('unlink', this.onUnlink.bind(this));
    }

    if (this.options.hmr) {
      this.hmr = new HMRServer;
    }

    try {
      this.mainAsset = await this.resolveAsset(this.mainFile);
      await this.loadAsset(this.mainAsset);

      await fs.mkdirp(this.options.outDir);

      let bundle = this.createBundleTree(this.mainAsset);
      this.bundleHashes = await bundle.package(this.options);

      this.pending = false;
      this.emit('bundled');
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
        asset.depAssets.set(dep.name, assetDep);
        await this.loadAsset(assetDep);
      }
    }));
  }

  createBundleTree(asset, dep, bundle) {
    if (dep) {
      asset.parentDeps.add(dep);
    }

    if (asset.parentBundle) {
      // If the asset is already in a bundle, it is shared. Move it to the lowest common ancestor.
      if (asset.parentBundle !== bundle) {
        let commonBundle = bundle.findCommonAncestor(asset.parentBundle);
        if (asset.parentBundle !== commonBundle && asset.parentBundle.type === commonBundle.type) {
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
      bundle.entryAsset = asset;
    }

    // Add the asset to the child bundle of the asset's type
    bundle.getChildBundle(asset.type).addAsset(asset);

    // If the asset generated a representation for the parent bundle type, also add it there
    if (asset.generated[bundle.type] != null) {
      bundle.addAsset(asset);
    }

    asset.parentBundle = bundle;

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
    this.bundleHashes = await bundle.package(this.options, this.bundleHashes);
    this.unloadOrphanedAssets();
    return bundle;
  }

  *findOrphanAssets() {
    for (let asset of this.loadedAssets.values()) {
      if (!asset.parentBundle) {
        yield asset;
      }
    }
  }

  unloadOrphanedAssets() {
    for (let asset of this.findOrphanAssets()) {
      this.unloadAsset(asset);
    }
  }

  unloadAsset(asset) {
    this.loadedAssets.delete(asset.name);
    if (this.watcher) {
      this.watcher.unwatch(asset.name);
    }
  }

  async onChange(path) {
    console.time('change');
    let asset = this.loadedAssets.get(path);
    if (!asset) {
      return;
    }

    this.pending = true;

    // Invalidate and reload the asset
    asset.invalidate();
    if (this.cache) {
      this.cache.invalidate(asset.name);
    }

    await this.loadAsset(asset);

    if (this.hmr) {
      // Emit an HMR update for any new assets (that don't have a parent bundle yet)
      // plus the asset that actually changed.
      let assets = [...this.findOrphanAssets(), asset];
      this.hmr.emitUpdate(assets);
    }

    await this.rebundle();
    this.pending = false;
    this.emit('bundled');
    console.timeEnd('change');
  }

  async onUnlink(path) {
    let asset = this.loadedAssets.get(path);
    if (!asset) {
      return;
    }

    this.unloadAsset(asset);
    if (this.cache) {
      this.cache.delete(path);
    }

    await this.rebundle();
  }

  middleware() {
    return Server.middleware(this);
  }

  serve(port) {
    this.bundle();
    return Server.serve(this, port);
  }
}

module.exports = Bundler;

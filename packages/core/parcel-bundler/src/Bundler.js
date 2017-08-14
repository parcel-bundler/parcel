const fs = require('./utils/fs');
const Resolver = require('./Resolver');
const Parser = require('./Parser');
const WorkerFarm = require('./WorkerFarm');
const worker = require('./utils/promisify')(require('./worker.js'));
const Path = require('path');
const Bundle = require('./Bundle');
const {FSWatcher} = require('chokidar');
const FSCache = require('./FSCache');

const crypto = require('crypto');

function md5(string) {
  return crypto.createHash('md5').update(string).digest('hex');
}

class Bundler {
  constructor(main, options = {}) {
    this.mainFile = main;
    this.options = this.normalizeOptions(options);

    this.resolver = new Resolver(options);
    this.parser = new Parser(options);
    this.cache = new FSCache(options);

    this.loadedAssets = new Map;
    this.rootBundle = null;
    this.farm = null;
    this.watcher = null;
  }

  normalizeOptions(options) {
    let isProduction = options.production || process.env.NODE_ENV === 'production';
    return Object.assign(options, {
      outDir: Path.resolve(options.outDir || 'dist'),
      watch: typeof options.watch === 'boolean' ? options.watch : !isProduction
    });
  }

  async bundle() {
    this.farm = new WorkerFarm(require.resolve('./worker.js'), {autoStart: true});

    if (this.options.watch) {
      this.watcher = new FSWatcher;
      this.watcher.on('change', this.onChange.bind(this));
      this.watcher.on('unlink', this.onUnlink.bind(this));
    }

    try {
      let main = await this.resolveAsset(this.mainFile);
      await this.loadAsset(main);

      await fs.mkdirp(this.options.outDir);
      await this.rootBundle.package();
    } finally {
      if (!this.watcher) {
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

  moveAssetToRoot(asset) {
    for (let bundle of Array.from(asset.bundles)) {
      bundle.removeAsset(asset);
      this.rootBundle.getChildBundle(bundle.type).addAsset(asset);
    }

    asset.parentBundle = this.rootBundle;

    for (let child of asset.depAssets.values()) {
      if (child.parentBundle !== this.rootBundle) {
        // console.log('move child', child.name, child.depAssets)
        this.moveAssetToRoot(child);
      }
    }
  }

  async loadAsset(asset, bundle) {
    if (asset.processed) {
      // If the asset is already in a bundle, it is shared. Add it to the root bundle.
      // TODO: this should probably be the common ancestor, not necessarily the root bundle.
      if (asset.parentBundle && asset.parentBundle !== bundle && asset.parentBundle !== this.rootBundle) {
        // asset.bundle.removeAsset(asset);
        // this.rootBundle.getChildBundle(asset.bundle.type).addAsset(asset);
        // for (let bundle of Array.from(asset.bundles)) {
        //   bundle.removeAsset(asset);
        //   this.rootBundle.getChildBundle(bundle.type).addAsset(asset);
        // }
        //
        // asset.parentBundle = this.rootBundle;
        this.moveAssetToRoot(asset);
      }

      return;
    }

    // Mark the asset processed so we don't load it twice
    asset.processed = true;

    // First try the cache, otherwise load and compile in the background
    let processed = await this.cache.read(asset.name);
    if (!processed) {
      processed = await this.farm.run(asset.name, asset.package, this.options);
      this.cache.write(asset.name, processed);
    }

    asset.dependencies = new Set(processed.dependencies);
    asset.generated = processed.generated;

    // Create the root bundle if it doesn't exist
    if (!bundle) {
      bundle = new Bundle(asset.type, Path.join(this.options.outDir, Path.basename(asset.name, Path.extname(asset.name)) + '.' + asset.type));
      this.rootBundle = bundle;
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

    // Process asset dependencies
    // await Promise.all(Array.from(asset.dependencies).map(async dep => {
    for (let dep of asset.dependencies) {
      let assetDep = await this.resolveAsset(dep.name, asset.name);
      asset.depAssets.set(dep.name, assetDep);

      let depBundle = bundle;
      if (dep.dynamic) {
        // split bundle
        // TODO: reuse split bundles if the same one is requested twice
        depBundle = new Bundle(bundle.type, Path.join(this.options.outDir, md5(assetDep.name) + '.' + assetDep.type));
        console.log(depBundle, assetDep.name)
        bundle.childBundles.add(depBundle);
      }

      await this.loadAsset(assetDep, depBundle);
    // }));
    }
  }

  async onChange(path) {
    console.time('change');
    let asset = this.loadedAssets.get(path);
    if (!asset) {
      return;
    }

    // Invalidate and reload the asset
    asset.invalidate();
    this.cache.invalidate(asset.name);
    await this.loadAsset(asset, asset.parentBundle);

    // Re-package all affected bundles
    for (let bundle of asset.bundles) {
      await bundle.package(false);
    }

    console.timeEnd('change');
  }

  async onUnlink(path) {
    let asset = this.loadedAssets.get(path);
    if (!asset) {
      return;
    }

    this.loadedAsset.delete(path);

    for (let bundle of asset.bundles) {
      bundle.removeAsset(asset);
      await bundle.package(false);
    }
  }
}

module.exports = Bundler;

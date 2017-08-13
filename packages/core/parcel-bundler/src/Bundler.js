const fs = require('./utils/fs');
const Resolver = require('./Resolver');
const Parser = require('./Parser');
const WorkerFarm = require('./WorkerFarm');
const worker = require('./utils/promisify')(require('./worker.js'));
const Path = require('path');
const Bundle = require('./Bundle');
const {FSWatcher} = require('chokidar');

class Bundler {
  constructor(main, options = {}) {
    this.mainFile = main;
    this.options = this.normalizeOptions(options);

    this.resolver = new Resolver(options);
    this.parser = new Parser(options);
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

  async loadAsset(asset, bundle) {
    if (asset.processed) {
      // If the asset is already in a bundle, it is shared. Add it to the root bundle.
      // TODO: this should probably be the common ancestor, not necessarily the root bundle.
      // if (asset.bundles.size > 0 && !asset.bundles.has(bundle)) {
      //   console.log(asset.bundles, asset.name)
      //   asset.bundle.removeAsset(asset);
      //   this.rootBundle.getChildBundle(asset.bundle.type).addAsset(asset);
      // }

      return;
    }

    // Compile and collect dependencies in the background
    await asset.processInFarm(this.farm);

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
    await Promise.all(Array.from(asset.dependencies).map(async dep => {
      let assetDep = await this.resolveAsset(dep, asset.name);
      asset.depAssets.set(dep, assetDep);

      let depBundle = bundle;
      // if (dep.dynamic) {
      //   // split bundle
      //   depBundle = new Bundle(basename(asset.name));
      // }


      await this.loadAsset(assetDep, depBundle);
    }));
  }

  async onChange(path) {
    console.time('change');
    let asset = this.loadedAssets.get(path);
    if (!asset) {
      return;
    }

    // Invalidate and reload the asset
    asset.invalidate();
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

const fs = require('./utils/fs');
const Resolver = require('./Resolver');
const Parser = require('./Parser');
const WorkerFarm = require('./WorkerFarm');
const Path = require('path');
const Bundle = require('./Bundle');
const {FSWatcher} = require('chokidar');
const FSCache = require('./FSCache');
const HMRServer = require('./HMRServer');
const Server = require('./Server');
const {EventEmitter} = require('events');
const logger = require('./Logger');
const PackagerRegistry = require('./packagers');
const localRequire = require('./utils/localRequire');
const config = require('./utils/config');
const emoji = require('./utils/emoji');
const loadEnv = require('./utils/env');
const PromiseQueue = require('./utils/PromiseQueue');
const bundleReport = require('./utils/bundleReport');
const prettifyTime = require('./utils/prettifyTime');

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
    this.packagers = new PackagerRegistry();
    this.cache = this.options.cache ? new FSCache(this.options) : null;
    this.delegate = options.delegate || {};
    this.bundleLoaders = {};

    this.addBundleLoader(
      'wasm',
      require.resolve('./builtins/loaders/wasm-loader')
    );
    this.addBundleLoader(
      'css',
      require.resolve('./builtins/loaders/css-loader')
    );
    this.addBundleLoader('js', require.resolve('./builtins/loaders/js-loader'));

    this.pending = false;
    this.loadedAssets = new Map();
    this.watchedAssets = new Map();
    this.farm = null;
    this.watcher = null;
    this.hmr = null;
    this.bundleHashes = null;
    this.errored = false;
    this.buildQueue = new PromiseQueue(this.processAsset.bind(this));
    this.rebuildTimeout = null;

    logger.setOptions(this.options);
  }

  normalizeOptions(options) {
    const isProduction =
      options.production || process.env.NODE_ENV === 'production';
    const publicURL =
      options.publicUrl ||
      options.publicURL ||
      '/' + Path.basename(options.outDir || 'dist');
    const watch =
      typeof options.watch === 'boolean' ? options.watch : !isProduction;
    const target = options.target || 'browser';
    return {
      outDir: Path.resolve(options.outDir || 'dist'),
      outFile: options.outFile || '',
      publicURL: publicURL,
      watch: watch,
      cache: typeof options.cache === 'boolean' ? options.cache : true,
      cacheDir: Path.resolve(options.cacheDir || '.cache'),
      killWorkers:
        typeof options.killWorkers === 'boolean' ? options.killWorkers : true,
      minify:
        typeof options.minify === 'boolean' ? options.minify : isProduction,
      target: target,
      hmr:
        target === 'node'
          ? false
          : typeof options.hmr === 'boolean' ? options.hmr : watch,
      https: options.https || false,
      logLevel: typeof options.logLevel === 'number' ? options.logLevel : 3,
      mainFile: this.mainFile,
      hmrPort: options.hmrPort || 0,
      rootDir: Path.dirname(this.mainFile),
      sourceMaps:
        typeof options.sourceMaps === 'boolean'
          ? options.sourceMaps
          : !isProduction,
      hmrHostname: options.hmrHostname || '',
      detailedReport: options.detailedReport || false
    };
  }

  addAssetType(extension, path) {
    if (typeof path !== 'string') {
      throw new Error('Asset type should be a module path.');
    }

    if (this.farm) {
      throw new Error('Asset types must be added before bundling.');
    }

    this.parser.registerExtension(extension, path);
  }

  addPackager(type, packager) {
    if (this.farm) {
      throw new Error('Packagers must be added before bundling.');
    }

    this.packagers.add(type, packager);
  }

  addBundleLoader(type, path) {
    if (typeof path !== 'string') {
      throw new Error('Bundle loader should be a module path.');
    }

    if (this.farm) {
      throw new Error('Bundle loaders must be added before bundling.');
    }

    this.bundleLoaders[type] = path;
  }

  async loadPlugins() {
    let pkg = await config.load(this.mainFile, ['package.json']);
    if (!pkg) {
      return;
    }

    try {
      let deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
      for (let dep in deps) {
        if (dep.startsWith('parcel-plugin-')) {
          let plugin = await localRequire(dep, this.mainFile);
          await plugin(this);
        }
      }
    } catch (err) {
      logger.warn(err);
    }
  }

  async bundle() {
    // If another bundle is already pending, wait for that one to finish and retry.
    if (this.pending) {
      return new Promise((resolve, reject) => {
        this.once('buildEnd', () => {
          this.bundle().then(resolve, reject);
        });
      });
    }

    let isInitialBundle = !this.mainAsset;
    let startTime = Date.now();
    this.pending = true;
    this.errored = false;

    logger.clear();
    logger.status(emoji.progress, 'Building...');

    try {
      // Start worker farm, watcher, etc. if needed
      await this.start();

      // If this is the initial bundle, ensure the output directory exists, and resolve the main asset.
      if (isInitialBundle) {
        await fs.mkdirp(this.options.outDir);

        this.mainAsset = await this.resolveAsset(this.mainFile);
        this.buildQueue.add(this.mainAsset);
      }

      // Build the queued assets.
      let loadedAssets = await this.buildQueue.run();

      // Emit an HMR update for any new assets (that don't have a parent bundle yet)
      // plus the asset that actually changed.
      if (this.hmr && !isInitialBundle) {
        this.hmr.emitUpdate([...this.findOrphanAssets(), ...loadedAssets]);
      }

      // Invalidate bundles
      for (let asset of this.loadedAssets.values()) {
        asset.invalidateBundle();
      }

      // Create a new bundle tree and package everything up.
      let bundle = this.createBundleTree(this.mainAsset);
      this.bundleHashes = await bundle.package(this, this.bundleHashes);

      // Unload any orphaned assets
      this.unloadOrphanedAssets();

      let buildTime = Date.now() - startTime;
      let time = prettifyTime(buildTime);
      logger.status(emoji.success, `Built in ${time}.`, 'green');
      if (!this.watcher) {
        bundleReport(bundle, this.options.detailedReport);
      }

      this.emit('bundled', bundle);
      return bundle;
    } catch (err) {
      this.errored = true;
      logger.error(err);
      if (this.hmr) {
        this.hmr.emitError(err);
      }

      if (process.env.NODE_ENV === 'production') {
        process.exitCode = 1;
      } else if (process.env.NODE_ENV === 'test' && !this.hmr) {
        throw err;
      }
    } finally {
      this.pending = false;
      this.emit('buildEnd');

      // If not in watch mode, stop the worker farm so we don't keep the process running.
      if (!this.watcher && this.options.killWorkers) {
        this.stop();
      }
    }
  }

  async start() {
    if (this.farm) {
      return;
    }

    await this.loadPlugins();
    await loadEnv(this.mainFile);

    this.options.extensions = Object.assign({}, this.parser.extensions);
    this.options.bundleLoaders = this.bundleLoaders;
    this.options.env = process.env;

    if (this.options.watch) {
      // FS events on macOS are flakey in the tests, which write lots of files very quickly
      // See https://github.com/paulmillr/chokidar/issues/612
      this.watcher = new FSWatcher({
        useFsEvents: process.env.NODE_ENV !== 'test'
      });

      this.watcher.on('change', this.onChange.bind(this));
    }

    if (this.options.hmr) {
      this.hmr = new HMRServer();
      this.options.hmrPort = await this.hmr.start(this.options);
    }

    this.farm = WorkerFarm.getShared(this.options);
  }

  stop() {
    if (this.farm) {
      this.farm.end();
    }

    if (this.watcher) {
      this.watcher.close();
    }

    if (this.hmr) {
      this.hmr.stop();
    }
  }

  async getAsset(name, parent) {
    let asset = await this.resolveAsset(name, parent);
    this.buildQueue.add(asset);
    await this.buildQueue.run();
    return asset;
  }

  async resolveAsset(name, parent) {
    let {path, pkg} = await this.resolver.resolve(name, parent);
    if (this.loadedAssets.has(path)) {
      return this.loadedAssets.get(path);
    }

    let asset = this.parser.getAsset(path, pkg, this.options);
    this.loadedAssets.set(path, asset);

    this.watch(path, asset);
    return asset;
  }

  watch(path, asset) {
    if (!this.watcher) {
      return;
    }

    if (!this.watchedAssets.has(path)) {
      this.watcher.add(path);
      this.watchedAssets.set(path, new Set());
    }

    this.watchedAssets.get(path).add(asset);
  }

  unwatch(path, asset) {
    if (!this.watchedAssets.has(path)) {
      return;
    }

    let watched = this.watchedAssets.get(path);
    watched.delete(asset);

    if (watched.size === 0) {
      this.watchedAssets.delete(path);
      this.watcher.unwatch(path);
    }
  }

  async resolveDep(asset, dep) {
    try {
      return await this.resolveAsset(dep.name, asset.name);
    } catch (err) {
      let thrown = err;

      if (thrown.message.indexOf(`Cannot find module '${dep.name}'`) === 0) {
        if (dep.optional) {
          return;
        }

        thrown.message = `Cannot resolve dependency '${dep.name}'`;

        // Add absolute path to the error message if the dependency specifies a relative path
        if (dep.name.startsWith('.')) {
          const absPath = Path.resolve(Path.dirname(asset.name), dep.name);
          err.message += ` at '${absPath}'`;
        }

        // Generate a code frame where the dependency was used
        if (dep.loc) {
          await asset.loadIfNeeded();
          thrown.loc = dep.loc;
          thrown = asset.generateErrorMessage(thrown);
        }

        thrown.fileName = asset.name;
      }
      throw thrown;
    }
  }

  async processAsset(asset, isRebuild) {
    if (isRebuild) {
      asset.invalidate();
      if (this.cache) {
        this.cache.invalidate(asset.name);
      }
    }

    await this.loadAsset(asset);
  }

  async loadAsset(asset) {
    if (asset.processed) {
      return;
    }

    if (!this.errored) {
      logger.status(emoji.progress, `Building ${asset.basename}...`);
    }

    // Mark the asset processed so we don't load it twice
    asset.processed = true;

    // First try the cache, otherwise load and compile in the background
    let startTime = Date.now();
    let processed = this.cache && (await this.cache.read(asset.name));
    if (!processed || asset.shouldInvalidate(processed.cacheData)) {
      processed = await this.farm.run(asset.name, asset.package, this.options);
      if (this.cache) {
        this.cache.write(asset.name, processed);
      }
    }

    asset.buildTime = Date.now() - startTime;
    asset.generated = processed.generated;
    asset.hash = processed.hash;

    // Call the delegate to get implicit dependencies
    let dependencies = processed.dependencies;
    if (this.delegate.getImplicitDependencies) {
      let implicitDeps = await this.delegate.getImplicitDependencies(asset);
      if (implicitDeps) {
        dependencies = dependencies.concat(implicitDeps);
      }
    }

    // Resolve and load asset dependencies
    let assetDeps = await Promise.all(
      dependencies.map(async dep => {
        if (dep.includedInParent) {
          // This dependency is already included in the parent's generated output,
          // so no need to load it. We map the name back to the parent asset so
          // that changing it triggers a recompile of the parent.
          this.watch(dep.name, asset);
        } else {
          let assetDep = await this.resolveDep(asset, dep);
          if (assetDep) {
            await this.loadAsset(assetDep);
          }

          return assetDep;
        }
      })
    );

    // Store resolved assets in their original order
    dependencies.forEach((dep, i) => {
      asset.dependencies.set(dep.name, dep);
      let assetDep = assetDeps[i];
      if (assetDep) {
        asset.depAssets.set(dep, assetDep);
      }
    });
  }

  createBundleTree(asset, dep, bundle, parentBundles = new Set()) {
    if (dep) {
      asset.parentDeps.add(dep);
    }

    if (asset.parentBundle) {
      // If the asset is already in a bundle, it is shared. Move it to the lowest common ancestor.
      if (asset.parentBundle !== bundle) {
        let commonBundle = bundle.findCommonAncestor(asset.parentBundle);
        if (
          asset.parentBundle !== commonBundle &&
          asset.parentBundle.type === commonBundle.type
        ) {
          this.moveAssetToBundle(asset, commonBundle);
          return;
        }
      } else {
        return;
      }

      // Detect circular bundles
      if (parentBundles.has(asset.parentBundle)) {
        return;
      }
    }

    if (!bundle) {
      // Create the root bundle if it doesn't exist
      bundle = Bundle.createWithAsset(asset);
    } else if (dep && dep.dynamic) {
      // Create a new bundle for dynamic imports
      bundle = bundle.createChildBundle(asset);
    } else if (asset.type && !this.packagers.has(asset.type)) {
      // No packager is available for this asset type. Create a new bundle with only this asset.
      bundle.createSiblingBundle(asset);
    } else {
      // Add the asset to the common bundle of the asset's type
      bundle.getSiblingBundle(asset.type).addAsset(asset);
    }

    // If the asset generated a representation for the parent bundle type, also add it there
    if (asset.generated[bundle.type] != null) {
      bundle.addAsset(asset);
    }

    // Add the asset to sibling bundles for each generated type
    if (asset.type && asset.generated[asset.type]) {
      for (let t in asset.generated) {
        if (asset.generated[t]) {
          bundle.getSiblingBundle(t).addAsset(asset);
        }
      }
    }

    asset.parentBundle = bundle;
    parentBundles.add(bundle);

    for (let [dep, assetDep] of asset.depAssets) {
      this.createBundleTree(assetDep, dep, bundle, parentBundles);
    }

    parentBundles.delete(bundle);
    return bundle;
  }

  moveAssetToBundle(asset, commonBundle) {
    // Never move the entry asset of a bundle, as it was explicitly requested to be placed in a separate bundle.
    if (asset.parentBundle.entryAsset === asset) {
      return;
    }

    for (let bundle of Array.from(asset.bundles)) {
      bundle.removeAsset(asset);
      commonBundle.getSiblingBundle(bundle.type).addAsset(asset);
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
      this.unwatch(asset.name, asset);

      // Unwatch all included dependencies that map to this asset
      for (let dep of asset.dependencies.values()) {
        if (dep.includedInParent) {
          this.unwatch(dep.name, asset);
        }
      }
    }
  }

  async onChange(path) {
    let assets = this.watchedAssets.get(path);
    if (!assets || !assets.size) {
      return;
    }

    logger.clear();
    logger.status(emoji.progress, `Building ${Path.basename(path)}...`);

    // Add the asset to the rebuild queue, and reset the timeout.
    for (let asset of assets) {
      this.buildQueue.add(asset, true);
    }

    clearTimeout(this.rebuildTimeout);

    this.rebuildTimeout = setTimeout(async () => {
      await this.bundle();
    }, 100);
  }

  middleware() {
    this.bundle();
    return Server.middleware(this);
  }

  async serve(port = 1234, https = false) {
    let server = await Server.serve(this, port, https);
    this.bundle();
    return server;
  }
}

module.exports = Bundler;
Bundler.Asset = require('./Asset');
Bundler.Packager = require('./packagers/Packager');

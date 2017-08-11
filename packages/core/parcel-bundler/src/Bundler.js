const fs = require('./utils/fs');
const Resolver = require('./Resolver');
const Parser = require('./Parser');
const WorkerFarm = require('./WorkerFarm');
const worker = require('./utils/promisify')(require('./worker.js'));
const Path = require('path');
const Bundle = require('./Bundle');

class Bundler {
  constructor(main, options = {}) {
    this.mainFile = main;
    this.options = options;
    this.outDir = Path.resolve(options.outDir || 'dist');
    this.resolver = new Resolver(options);
    this.parser = new Parser(options);

    this.loadedAssets = new Map;
    this.loading = new Set;
    this.rootBundle = null;
    this.farm = null;
  }

  async bundle() {
    this.farm = new WorkerFarm(require.resolve('./worker.js'), {autoStart: true});

    try {
      let main = await this.resolveAsset(this.mainFile);
      await this.loadAsset(main);

      await fs.mkdirp(this.outDir);
      await this.rootBundle.package();
    } finally {
      this.farm.end();
    }
  }

  async resolveAsset(name, parent) {
    let {path, pkg} = await this.resolver.resolve(name, parent);
    if (this.loadedAssets.has(path)) {
      return this.loadedAssets.get(path);
    }

    let asset = this.parser.getAsset(path, pkg, this.options);
    this.loadedAssets.set(path, asset);
    return asset;
  }

  async loadAsset(asset, bundle) {
    if (this.loading.has(asset)) {
      // If the asset is already in a bundle, it is shared. Add it to the root bundle.
      // TODO: this should probably be the common ancestor, not necessarily the root bundle.
      if (asset.bundle && asset.bundle !== bundle) {
        asset.bundle.removeAsset(asset);
        this.rootBundle.getChildBundle(asset.type).addAsset(asset);
      }

      return;
    }

    this.loading.add(asset);

    let {deps, contents, ast} = await this.farm.run(asset.name, asset.package, this.options);
    // let {deps, contents, ast} = await worker(asset.name, asset.package, this.options);

    asset.dependencies = deps;
    asset.contents = contents;
    asset.ast = ast;

    if (!bundle) {
      bundle = new Bundle(asset.type, Path.join(this.outDir, Path.basename(asset.name, Path.extname(asset.name)) + '.' + asset.type));
      this.rootBundle = bundle;
    } else if (asset.type !== bundle.type) {
      bundle = bundle.getChildBundle(asset.type);
    }

    bundle.addAsset(asset);

    await Promise.all(deps.map(async dep => {
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
}

module.exports = Bundler;

const fs = require('./utils/fs');
const Resolver = require('./Resolver');
const Parser = require('./Parser');
const WorkerFarm = require('./WorkerFarm');
const worker = require('./utils/promisify')(require('./worker.js'));

class Bundle {
  constructor(main, options) {
    this.mainFile = main;
    this.options = options;
    this.resolver = new Resolver(options);
    this.parser = new Parser(options);

    this.loadedAssets = new Map;
    this.loading = new Set;

    this.farm = new WorkerFarm(require.resolve('./worker.js'), {autoStart: true});
  }

  async collectDependencies() {
    let main = await this.resolveAsset(this.mainFile);
    await this.loadAsset(main);
    this.farm.end();
    return main;
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

  async loadAsset(asset) {
    if (this.loading.has(asset)) {
      return;
    }

    this.loading.add(asset);

    let {deps, contents, ast} = await this.farm.run(asset.name, asset.package, this.options);
    // let {deps, contents, ast} = await worker(asset.name, asset.package, this.options);

    asset.dependencies = deps;
    asset.contents = contents;
    asset.ast = ast;

    await Promise.all(deps.map(async dep => {
      let assetDep = await this.resolveAsset(dep, asset.name);
      asset.depAssets.set(dep, assetDep);
      await this.loadAsset(assetDep);
    }));
  }
}

module.exports = Bundle;

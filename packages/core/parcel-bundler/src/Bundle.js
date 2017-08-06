const fs = require('./utils/fs');
const Resolver = require('./Resolver');
const Parser = require('./Parser');
const WorkerFarm = require('./WorkerFarm');

class Bundle {
  constructor(main, options) {
    this.mainFile = main;
    this.options = options;
    this.resolver = new Resolver(options);
    this.parser = new Parser(options);

    this.loadedModules = new Map;
    this.loading = new Set;

    this.farm = new WorkerFarm(require.resolve('./worker.js'), {autoStart: true});
  }

  async collectDependencies() {
    let main = await this.resolveModule(this.mainFile);
    await this.loadModule(main);
    this.farm.end();
    return main;
  }

  async resolveModule(name, parent) {
    let {path, package: pkg} = await this.resolver.resolve(name, parent);
    if (this.loadedModules.has(path)) {
      return this.loadedModules.get(path);
    }

    let module = this.parser.getAsset(path, pkg, this.options);
    this.loadedModules.set(path, module);
    return module;
  }

  async loadModule(module) {
    if (this.loading.has(module)) {
      return;
    }

    this.loading.add(module);

    let {deps, contents, ast} = await this.farm.run(module.name, this.options);

    module.dependencies = deps;
    module.contents = contents;
    module.ast = ast;

    await Promise.all(deps.map(async dep => {
      let mod = await this.resolveModule(dep, module.name);
      module.modules.set(dep, mod);
      await this.loadModule(mod);
    }));
  }
}

module.exports = Bundle;

import path from 'path';
import Config from './Config';

export default class BundlerRunner {
  constructor(opts) {
    this.config = opts.config;
  }

  async bundle(graph /* , opts */) {
    let bundler = await this.config.getBundler();
    let {bundles} = await bundler.bundle(graph);
    let namers = await this.config.getNamers();

    let bundleMap = {};

    for (let bundle of bundles) {
      let name;
      for (let namer of namers) {
        name = namer.name(bundle);
        if (name) break;
      }

      if (!name) throw new Error('Unable to name bundle');
      bundleMap[name] = bundle;
    }

    return bundleMap;
  }
}

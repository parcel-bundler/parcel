// @flow
import path from 'path';
import type Config from './Config';
import BundleGraph from './BundleGraph';

export default class BundlerRunner {
  config: Config;

  constructor(opts) {
    this.config = opts.config;
  }

  async bundle(graph /* , opts */) {
    let bundler = await this.config.getBundler();

    let bundleGraph = new BundleGraph();
    bundler.bundle(graph, bundleGraph);
    return bundleGraph;
  }
}

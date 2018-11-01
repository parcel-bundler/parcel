import path from 'path';
import Config from './Config';

export default class BundlerRunner {
  constructor(opts) {
    this.config = opts.config;
  }

  async bundle(graph /* , opts */) {
    let bundler = await this.config.getBundler();

    return bundler.bundle(graph);
  }
}

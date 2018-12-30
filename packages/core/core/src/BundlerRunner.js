// @flow
import type {
  AssetGraph,
  Namer,
  Bundle,
  FilePath,
  CLIOptions
} from '@parcel/types';
import path from 'path';
import type Config from './Config';
import BundleGraph from './BundleGraph';

type Opts = {
  cliOpts: CLIOptions,
  config: Config,
  rootDir: FilePath
};

export default class BundlerRunner {
  cliOpts: CLIOptions;
  config: Config;
  rootDir: FilePath;

  constructor(opts: Opts) {
    this.cliOpts = opts.cliOpts;
    this.config = opts.config;
    this.rootDir = opts.rootDir;
  }

  async bundle(graph: AssetGraph) {
    let bundler = await this.config.getBundler();

    let bundleGraph = new BundleGraph();
    await bundler.bundle(graph, bundleGraph, this.cliOpts);
    await this.nameBundles(bundleGraph);

    return bundleGraph;
  }

  async nameBundles(bundleGraph: BundleGraph) {
    let namers = await this.config.getNamers();
    let promises = [];
    bundleGraph.traverseBundles(bundle => {
      promises.push(this.nameBundle(namers, bundle));
    });

    await Promise.all(promises);
  }

  async nameBundle(namers: Array<Namer>, bundle: Bundle) {
    for (let namer of namers) {
      let filePath = await namer.name(bundle, {
        rootDir: this.rootDir
      });

      if (filePath) {
        bundle.filePath = filePath;
        return;
      }
    }

    throw new Error('Unable to name bundle');
  }
}

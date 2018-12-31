// @flow
import type Config from './Config';
import Cache from '@parcel/cache';
import {mkdirp, writeFile} from '@parcel/fs';
import path from 'path';
import type {Bundle, CLIOptions, Blob, FilePath} from '@parcel/types';
import AssetGraph from './AssetGraph';
import Asset from './Asset';

type Opts = {
  config: Config,
  cliOpts: CLIOptions
};

export default class PackagerRunner {
  config: Config;
  cliOpts: CLIOptions;
  cache: Cache;
  distDir: FilePath;
  distExists: Set<FilePath>;

  constructor({config, cliOpts}: Opts) {
    this.config = config;
    this.cliOpts = cliOpts;
    this.cache = new Cache(cliOpts);
    this.distExists = new Set();
  }

  async writeBundle(bundle: Bundle) {
    // deserialize asset graph from JSON
    bundle.assetGraph = new AssetGraph(bundle.assetGraph);
    bundle.assetGraph.traverse(node => {
      if (node.type === 'asset') {
        node.value = new Asset({...node.value, cache: this.cache});
      }
    });

    let contents = await this.package(bundle);
    contents = await this.optimize(bundle, contents);

    // $FlowFixMe - filePath should already be filled in at this point
    let dir = path.dirname(bundle.filePath);
    if (!this.distExists.has(dir)) {
      await mkdirp(dir);
      this.distExists.add(dir);
    }

    await writeFile(bundle.filePath, contents);
  }

  async package(bundle: Bundle): Promise<Blob> {
    // $FlowFixMe - filePath should already be filled in at this point
    let packager = await this.config.getPackager(bundle.filePath);
    return await packager.package(bundle, this.cliOpts);
  }

  async optimize(bundle: Bundle, contents: Blob): Promise<Blob> {
    // $FlowFixMe - filePath should already be filled in at this point
    let optimizers = await this.config.getOptimizers(bundle.filePath);

    for (let optimizer of optimizers) {
      contents = await optimizer.optimize(bundle, contents, this.cliOpts);
    }

    return contents;
  }
}

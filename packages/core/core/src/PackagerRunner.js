// @flow
import type Config from './Config';
import Cache from '@parcel/cache';
import {mkdirp, writeFile} from '@parcel/fs';
import path from 'path';
import type {Bundle, CLIOptions, Blob, FilePath} from '@parcel/types';
import clone from 'clone';
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
  distExists: boolean;

  constructor({config, cliOpts}: Opts) {
    this.config = config;
    this.cliOpts = cliOpts;
    this.cache = new Cache(cliOpts);
    this.distDir = path.resolve(this.cliOpts.distDir || 'dist');
    this.distExists = false;
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

    if (!this.distExists) {
      await mkdirp(this.distDir);
      this.distExists = true;
    }

    let filePath = path.join(this.distDir, bundle.filePath);
    if (bundle.filePath.includes(path.sep)) {
      await mkdirp(path.dirname(filePath));
    }

    await writeFile(filePath, contents);
  }

  async package(bundle: Bundle): Promise<Blob> {
    let packager = await this.config.getPackager(bundle.filePath);
    return await packager.package(bundle, this.cliOpts);
  }

  async optimize(bundle: Bundle, contents: Blob): Promise<Blob> {
    let optimizers = await this.config.getOptimizers(bundle.filePath);

    for (let optimizer of optimizers) {
      contents = await optimizer.optimize(bundle, contents, this.cliOpts);
    }

    return contents;
  }
}

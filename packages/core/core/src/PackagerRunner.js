// @flow
import type {Bundle, CLIOptions, Blob, FilePath} from '@parcel/types';
import type Config from './Config';

import {mkdirp, writeFile} from '@parcel/fs';
import nullthrows from 'nullthrows';
import path from 'path';

type Opts = {|
  config: Config,
  cliOpts: CLIOptions
|};

export default class PackagerRunner {
  config: Config;
  cliOpts: CLIOptions;
  distDir: FilePath;
  distExists: Set<FilePath>;

  constructor({config, cliOpts}: Opts) {
    this.config = config;
    this.cliOpts = cliOpts;
    this.distExists = new Set();
  }

  async writeBundle(bundle: Bundle) {
    let contents = await this.package(bundle);
    contents = await this.optimize(bundle, contents);

    let filePath = nullthrows(bundle.filePath);
    let dir = path.dirname(filePath);
    if (!this.distExists.has(dir)) {
      await mkdirp(dir);
      this.distExists.add(dir);
    }

    await writeFile(filePath, contents);
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

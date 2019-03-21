// @flow

import type {Bundle, ParcelOptions, Blob, FilePath} from '@parcel/types';
import type Config from './ParcelConfig';

import {mkdirp, writeFile} from '@parcel/fs';
import nullthrows from 'nullthrows';
import path from 'path';
import {report} from './ReporterRunner';

type Opts = {|
  config: Config,
  options: ParcelOptions
|};

export default class PackagerRunner {
  config: Config;
  options: ParcelOptions;
  distDir: FilePath;
  distExists: Set<FilePath>;

  constructor({config, options}: Opts) {
    this.config = config;
    this.options = options;
    this.distExists = new Set();
  }

  async writeBundle(bundle: Bundle) {
    let start = Date.now();
    let contents = await this.package(bundle);
    contents = await this.optimize(bundle, contents);

    let filePath = nullthrows(bundle.filePath);
    let dir = path.dirname(filePath);
    if (!this.distExists.has(dir)) {
      await mkdirp(dir);
      this.distExists.add(dir);
    }

    await writeFile(nullthrows(bundle.filePath), contents);
    return {
      time: Date.now() - start,
      size: contents.length
    };
  }

  async package(bundle: Bundle): Promise<Blob> {
    report({
      type: 'buildProgress',
      phase: 'packaging',
      bundle
    });

    let packager = await this.config.getPackager(nullthrows(bundle.filePath));
    return packager.package(bundle, this.options);
  }

  async optimize(bundle: Bundle, contents: Blob): Promise<Blob> {
    let optimizers = await this.config.getOptimizers(
      nullthrows(bundle.filePath)
    );
    if (!optimizers.length) {
      return contents;
    }

    report({
      type: 'buildProgress',
      phase: 'optimizing',
      bundle
    });

    for (let optimizer of optimizers) {
      contents = await optimizer.optimize(bundle, contents, this.options);
    }

    return contents;
  }
}

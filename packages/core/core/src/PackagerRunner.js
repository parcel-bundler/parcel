// @flow

import {Readable} from 'stream';
import type {ParcelOptions, Blob, FilePath} from '@parcel/types';
import type {Bundle as InternalBundle} from './types';
import type Config from './ParcelConfig';

import {mkdirp, writeFile, writeFileStream} from '@parcel/fs';
import TapStream from '@parcel/utils/src/TapStream';
import {NamedBundle} from './public/Bundle';
import nullthrows from 'nullthrows';
import path from 'path';
import {report} from './ReporterRunner';

import dumpToGraphViz from './dumpGraphToGraphViz';

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

  async writeBundle(bundle: InternalBundle) {
    let start = Date.now();
    let contents = await this.package(bundle);
    contents = await this.optimize(bundle, contents);

    let filePath = nullthrows(bundle.filePath);
    let dir = path.dirname(filePath);
    if (!this.distExists.has(dir)) {
      await mkdirp(dir);
      this.distExists.add(dir);
    }

    let size;
    if (contents instanceof Readable) {
      size = 0;
      await writeFileStream(
        filePath,
        contents.pipe(new TapStream(chunk => (size += chunk.length)))
      );
    } else {
      await writeFile(filePath, contents);
      size = contents.length;
    }

    return {
      time: Date.now() - start,
      size
    };
  }

  async package(internalBundle: InternalBundle): Promise<Blob> {
    let bundle = new NamedBundle(internalBundle);
    report({
      type: 'buildProgress',
      phase: 'packaging',
      bundle
    });

    let packager = await this.config.getPackager(bundle.filePath);
    return packager.package(bundle, this.options);
  }

  async optimize(
    internalBundle: InternalBundle,
    contents: Blob
  ): Promise<Blob> {
    let bundle = new NamedBundle(internalBundle);
    let optimizers = await this.config.getOptimizers(bundle.filePath);
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

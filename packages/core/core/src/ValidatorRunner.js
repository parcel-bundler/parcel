// @flow

import type {
  Blob,
  File,
  FilePath,
  Validator,
  AssetRequest,
  ParcelOptions
} from '@parcel/types';

import path from 'path';
import {
  md5FromFilePath,
  md5FromReadableStream,
  md5FromString
} from '@parcel/utils';
import Cache from '@parcel/cache';
import {TapStream} from '@parcel/utils';
import {createReadStream} from 'fs';

import Dependency from './Dependency';
import Config from './Config';
import ResolverRunner from './ResolverRunner';
import {report} from './ReporterRunner';
import {MutableAsset} from './public/Asset';
import InternalAsset from './Asset';

type Opts = {|
  config: Config,
  options: ParcelOptions
|};

const BUFFER_LIMIT = 5000000; // 5mb

export default class validatorRunner {
  options: ParcelOptions;
  config: Config;
  resolverRunner: ResolverRunner;

  constructor({config, options}: Opts) {
    this.options = options;
    this.config = config;
    this.resolverRunner = new ResolverRunner({
      config,
      options
    });
  }

  async runValidate(input: InternalAsset, validator: Validator) {
    const resolve = async (from: FilePath, to: string): Promise<FilePath> => {
      return (await this.resolverRunner.resolve(
        new Dependency({
          env: input.env,
          moduleSpecifier: to,
          sourcePath: from
        })
      )).filePath;
    };

    // Load config for the transformer.
    await validator.validate({
      asset: new MutableAsset(input),
      resolve,
      options: this.options
    });
  }

  async validate(req: AssetRequest): Promise<void> {
    report({
      type: 'buildProgress',
      phase: 'validating',
      request: req
    });

    let cacheEntry;
    if (this.options.cache !== false && req.code == null) {
      cacheEntry = await Cache.get(reqCacheKey(req));
    }

    let {content, size, hash} = await summarizeRequest(req);
    if (
      cacheEntry &&
      cacheEntry.hash === hash &&
      (await checkCachedAssets(cacheEntry.assets))
    ) {
      return;
    }

    let input = new InternalAsset({
      // If the transformer request passed code rather than a filename,
      // use a hash as the base for the id to ensure it is unique.
      idBase: req.code ? hash : req.filePath,
      filePath: req.filePath,
      type: path.extname(req.filePath).slice(1),
      ast: null,
      content,
      hash,
      env: req.env,
      stats: {
        time: 0,
        size
      },
      sideEffects: req.sideEffects
    });

    let pipeline = await this.config.getValidators(req.filePath);
    await Promise.all(
      pipeline.map(validator => {
        return this.runValidate(input, validator);
      })
    );
  }
}

async function checkConnectedFiles(files: Array<File>): Promise<boolean> {
  let hashes = await Promise.all(
    files.map(file => md5FromFilePath(file.filePath))
  );

  return files.every((file, index) => file.hash === hashes[index]);
}

async function checkCachedAssets(
  assets: Array<InternalAsset>
): Promise<boolean> {
  let results = await Promise.all(
    assets.map(asset => checkConnectedFiles(asset.getConnectedFiles()))
  );

  return results.every(Boolean);
}

async function summarizeRequest(
  req: AssetRequest
): Promise<{|content: Blob, hash: string, size: number|}> {
  let code = req.code;
  let content: Blob;
  let hash: string;
  let size: number;
  if (code == null) {
    // As an optimization for the common case of source code, while we read in
    // data to compute its md5 and size, buffer its contents in memory.
    // This avoids reading the data now, and then again during transformation.
    // If it exceeds BUFFER_LIMIT, throw it out and replace it with a stream to
    // lazily read it at a later point.
    content = Buffer.from([]);
    size = 0;
    hash = await md5FromReadableStream(
      createReadStream(req.filePath).pipe(
        new TapStream(buf => {
          size += buf.length;
          if (content instanceof Buffer) {
            if (size > BUFFER_LIMIT) {
              // if buffering this content would put this over BUFFER_LIMIT, replace
              // it with a stream
              content = createReadStream(req.filePath);
            } else {
              content = Buffer.concat([content, buf]);
            }
          }
        })
      )
    );
  } else {
    content = code;
    hash = md5FromString(code);
    size = Buffer.from(code).length;
  }

  return {content, hash, size};
}

function reqCacheKey(req: AssetRequest): string {
  return md5FromString(req.filePath + JSON.stringify(req.env));
}

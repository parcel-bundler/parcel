// @flow strict-local
import nullthrows from 'nullthrows';
import type {
  MutableAsset as IMutableAsset,
  Blob,
  FilePath,
  GenerateOutput,
  Validator,
  AssetRequest,
  ParcelOptions,
  PackageName
} from '@parcel/types';

import path from 'path';
import {md5FromReadableStream, md5FromString, TapStream} from '@parcel/utils';
import Cache from '@parcel/cache';
import {createReadStream} from 'fs';

import type Config from './public/Config';
import Dependency from './Dependency';
import ResolverRunner from './ResolverRunner';
import {report} from './ReporterRunner';
import InternalAsset from './Asset';
import type {NodeId, ConfigRequest} from './types';
import {MutableAsset} from './public/Asset';

type GenerateFunc = (input: IMutableAsset) => Promise<GenerateOutput>;

type PostProcessFunc = (
  Array<InternalAsset>
) => Promise<Array<InternalAsset> | null>;

const BUFFER_LIMIT = 5000000; // 5mb

export type ValidationOpts = {|
  request: AssetRequest,
  loadConfig: (ConfigRequest, NodeId) => Promise<Config>,
  parentNodeId: NodeId,
  options: ParcelOptions
|};

type ConfigMap = Map<PackageName, Config>;

export default class Validation {
  request: AssetRequest;
  configRequests: Array<ConfigRequest>;
  loadConfig: ConfigRequest => Promise<Config>;
  options: ParcelOptions;
  cache: Cache;
  impactfulOptions: $Shape<ParcelOptions>;

  constructor({request, loadConfig, parentNodeId, options}: ValidationOpts) {
    this.request = request;
    this.configRequests = [];
    this.loadConfig = configRequest => {
      this.configRequests.push(configRequest);
      return loadConfig(configRequest, parentNodeId);
    };
    this.options = options;
  }

  async run(): Promise<void> {
    if (this.request.filePath.includes('node_modules')) return;

    report({
      type: 'validation',
      request: this.request
    });

    this.cache = new Cache(this.options.cacheDir);

    let asset = await this.loadAsset();
    let pipeline = await this.loadPipeline(asset.filePath);
    await pipeline.run(asset);
  }

  async loadAsset(): Promise<InternalAsset> {
    let {filePath, env, code, sideEffects} = this.request;
    let {content, size, hash} = await summarizeRequest(this.request);

    return new InternalAsset({
      // If the transformer request passed code rather than a filename,
      // use a hash as the base for the id to ensure it is unique.
      idBase: code != null ? hash : filePath,
      filePath: filePath,
      type: path.extname(filePath).slice(1),
      cache: this.cache,
      ast: null,
      content,
      hash,
      env: env,
      stats: {
        time: 0,
        size
      },
      sideEffects: sideEffects
    });
  }

  async loadPipeline(filePath: FilePath): Promise<Pipeline> {
    let configRequest = {
      filePath,
      meta: {
        actionType: 'validation'
      }
    };
    let configs = new Map();

    let config = await this.loadConfig(configRequest);
    let parcelConfig = nullthrows(config.result);

    configs.set('parcel', config);

    let pipeline = new Pipeline({
      validators: await parcelConfig.getValidators(filePath),
      configs,
      options: this.options
    });

    return pipeline;
  }
}

type PipelineOpts = {|
  validators: Array<Validator>,
  configs: ConfigMap,
  options: ParcelOptions
|};

class Pipeline {
  validators: Array<Validator>;
  configs: ConfigMap;
  options: ParcelOptions;
  resolverRunner: ResolverRunner;
  generate: GenerateFunc;
  postProcess: ?PostProcessFunc;

  constructor({validators, configs, options}: PipelineOpts) {
    this.validators = validators;
    this.configs = configs;
    this.options = options;
    let parcelConfig = nullthrows(this.configs.get('parcel'));
    parcelConfig = nullthrows(parcelConfig.result);
    this.resolverRunner = new ResolverRunner({
      config: parcelConfig,
      options
    });
  }

  async run(asset: InternalAsset): Promise<void> {
    const resolve = async (from: FilePath, to: string): Promise<FilePath> => {
      return (await this.resolverRunner.resolve(
        new Dependency({
          env: asset.env,
          moduleSpecifier: to,
          sourcePath: from
        })
      )).filePath;
    };

    for (let validator of this.validators) {
      await validator.validate({
        asset: new MutableAsset(asset),
        options: this.options,
        resolve
      });
    }
  }
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

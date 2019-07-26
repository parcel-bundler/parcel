// @flow strict-local
import nullthrows from 'nullthrows';
import type {FilePath, AssetRequest, ParcelOptions} from '@parcel/types';

import path from 'path';
import Cache from '@parcel/cache';

import type Config from './public/Config';
import Dependency from './Dependency';
import ResolverRunner from './ResolverRunner';
import {report} from './ReporterRunner';
import InternalAsset from './Asset';
import type {NodeId, ConfigRequest} from './types';
import {MutableAsset} from './public/Asset';
import summarizeRequest from './summarizeRequest';

export type ValidationOpts = {|
  request: AssetRequest,
  loadConfig: (ConfigRequest, NodeId) => Promise<Config>,
  parentNodeId: NodeId,
  options: ParcelOptions
|};

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

    this.cache = new Cache(this.options.outputFS, this.options.cacheDir);

    let asset = await this.loadAsset();
    let configRequest = {
      filePath: this.request.filePath,
      meta: {
        actionType: 'validation'
      }
    };

    let config = await this.loadConfig(configRequest);
    let parcelConfig = nullthrows(config.result);

    let validators = await parcelConfig.getValidators(this.request.filePath);
    let resolverRunner = new ResolverRunner({
      config: parcelConfig,
      options: this.options
    });

    const resolve = async (from: FilePath, to: string): Promise<FilePath> => {
      return (await resolverRunner.resolve(
        new Dependency({
          env: asset.env,
          moduleSpecifier: to,
          sourcePath: from
        })
      )).filePath;
    };

    for (let validator of validators) {
      await validator.validate({
        asset: new MutableAsset(asset),
        options: this.options,
        resolve
      });
    }
  }

  async loadAsset(): Promise<InternalAsset> {
    let {filePath, env, code, sideEffects} = this.request;
    let {content, size, hash} = await summarizeRequest(
      this.options.inputFS,
      this.request
    );

    return new InternalAsset({
      // If the transformer request passed code rather than a filename,
      // use a hash as the base for the id to ensure it is unique.
      idBase: code != null ? hash : filePath,
      fs: this.options.inputFS,
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
}

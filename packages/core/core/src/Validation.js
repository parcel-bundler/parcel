// @flow strict-local

import type {WorkerApi} from '@parcel/workers';
import type {
  AssetRequest,
  Config,
  NodeId,
  ConfigRequest,
  ParcelOptions
} from './types';
import type ParcelConfig from './ParcelConfig';

import path from 'path';
import nullthrows from 'nullthrows';
import {resolveConfig} from '@parcel/utils';
import {localRequireFromWorker} from '@parcel/local-require';

import {report} from './ReporterRunner';
import InternalAsset, {createAsset} from './InternalAsset';
import {Asset} from './public/Asset';
import PluginOptions from './public/PluginOptions';
import summarizeRequest from './summarizeRequest';

export type ValidationOpts = {|
  request: AssetRequest,
  loadConfig: (ConfigRequest, NodeId) => Promise<Config>,
  parentNodeId: NodeId,
  options: ParcelOptions,
  workerApi: WorkerApi
|};

export default class Validation {
  request: AssetRequest;
  configRequests: Array<ConfigRequest>;
  loadConfig: ConfigRequest => Promise<Config>;
  options: ParcelOptions;
  impactfulOptions: $Shape<ParcelOptions>;
  workerApi: WorkerApi;

  constructor({
    request,
    loadConfig,
    parentNodeId,
    options,
    workerApi
  }: ValidationOpts) {
    this.request = request;
    this.configRequests = [];
    this.loadConfig = configRequest => {
      this.configRequests.push(configRequest);
      return loadConfig(configRequest, parentNodeId);
    };
    this.options = options;
    this.workerApi = workerApi;
  }

  async run(): Promise<void> {
    report({
      type: 'validation',
      filePath: this.request.filePath
    });

    let asset = await this.loadAsset();

    let configRequest = {
      filePath: this.request.filePath,
      meta: {
        actionType: 'validation'
      },
      env: this.request.env
    };

    let config = await this.loadConfig(configRequest);
    let parcelConfig: ParcelConfig = nullthrows(config.result);
    let localRequire = localRequireFromWorker.bind(null, this.workerApi);

    let validators = await parcelConfig.getValidators(this.request.filePath);
    for (let validator of validators) {
      await validator.validate({
        asset: new Asset(asset),
        options: new PluginOptions(this.options),
        resolveConfig: (configNames: Array<string>) =>
          resolveConfig(
            this.options.inputFS,
            asset.value.filePath,
            configNames
          ),
        localRequire
      });
    }
  }

  async loadAsset(): Promise<InternalAsset> {
    let {filePath, env, code, sideEffects} = this.request;
    let {content, size, hash} = await summarizeRequest(
      this.options.inputFS,
      this.request
    );

    // If the transformer request passed code rather than a filename,
    // use a hash as the base for the id to ensure it is unique.
    let idBase = code != null ? hash : filePath;
    return new InternalAsset({
      idBase,
      value: createAsset({
        idBase,
        filePath: filePath,
        type: path.extname(filePath).slice(1),
        hash,
        env: env,
        stats: {
          time: 0,
          size
        },
        sideEffects: sideEffects
      }),
      options: this.options,
      content
    });
  }
}

// @flow strict-local

import type {
  AssetRequest,
  Config,
  NodeId,
  ConfigRequest,
  ParcelOptions
} from './types';

import path from 'path';
import nullthrows from 'nullthrows';
import {resolveConfig} from '@parcel/utils';

import {report} from './ReporterRunner';
import InternalAsset, {createAsset} from './InternalAsset';
import {Asset} from './public/Asset';
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
    let parcelConfig = nullthrows(config.result);

    let validators = await parcelConfig.getValidators(this.request.filePath);
    for (let validator of validators) {
      await validator.validate({
        asset: new Asset(asset),
        options: this.options,
        resolveConfig: (configNames: Array<string>) =>
          resolveConfig(this.options.inputFS, asset.value.filePath, configNames)
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

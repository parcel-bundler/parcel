// @flow strict-local

import type {WorkerApi} from '@parcel/workers';
import type {
  AssetRequestDesc,
  ConfigRequestDesc,
  ParcelOptions,
  ReportFn,
} from './types';

import path from 'path';
import nullthrows from 'nullthrows';
import {resolveConfig} from '@parcel/utils';
import logger, {PluginLogger} from '@parcel/logger';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import ParcelConfig from './ParcelConfig';
import ConfigLoader from './ConfigLoader';
import InternalAsset, {createAsset} from './InternalAsset';
import {Asset} from './public/Asset';
import PluginOptions from './public/PluginOptions';
import summarizeRequest from './summarizeRequest';

export type ValidationOpts = {|
  options: ParcelOptions,
  request: AssetRequestDesc,
  report: ReportFn,
  workerApi: WorkerApi,
|};

export default class Validation {
  request: AssetRequestDesc;
  configRequests: Array<ConfigRequestDesc>;
  configLoader: ConfigLoader;
  options: ParcelOptions;
  impactfulOptions: $Shape<ParcelOptions>;
  report: ReportFn;
  workerApi: WorkerApi;

  constructor({request, report, options, workerApi}: ValidationOpts) {
    this.configLoader = new ConfigLoader(options);
    this.options = options;
    this.report = report;
    this.request = request;
    this.workerApi = workerApi;
  }

  async run(): Promise<void> {
    this.report({
      type: 'validation',
      filePath: this.request.filePath,
    });

    let asset = await this.loadAsset();

    let configRequest = {
      filePath: this.request.filePath,
      isSource: asset.value.isSource,
      meta: {
        actionType: 'validation',
      },
      env: this.request.env,
    };

    let config = await this.configLoader.load(configRequest);
    nullthrows(config.result);
    let parcelConfig = new ParcelConfig(
      config.result,
      this.options.packageManager,
    );

    let validators = await parcelConfig.getValidators(this.request.filePath);
    let pluginOptions = new PluginOptions(this.options);

    for (let validator of validators) {
      let validatorLogger = new PluginLogger({origin: validator.name});
      try {
        let config = null;
        if (validator.plugin.getConfig) {
          config = await validator.plugin.getConfig({
            asset: new Asset(asset),
            options: pluginOptions,
            logger: validatorLogger,
            resolveConfig: (configNames: Array<string>) =>
              resolveConfig(
                this.options.inputFS,
                asset.value.filePath,
                configNames,
              ),
          });
        }

        let validatorResult = await validator.plugin.validate({
          asset: new Asset(asset),
          options: pluginOptions,
          config,
          logger: validatorLogger,
        });

        if (validatorResult) {
          let {warnings, errors} = validatorResult;

          if (errors.length > 0) {
            throw new ThrowableDiagnostic({
              diagnostic: errors,
            });
          }

          if (warnings.length > 0) {
            logger.warn(warnings);
          }
        }
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, validator.name),
        });
      }
    }
  }

  async loadAsset(): Promise<InternalAsset> {
    let {filePath, env, code, sideEffects} = this.request;
    let {content, size, hash, isSource} = await summarizeRequest(
      this.options.inputFS,
      this.request,
    );

    // If the transformer request passed code rather than a filename,
    // use a hash as the base for the id to ensure it is unique.
    let idBase =
      code != null
        ? hash
        : path
            .relative(this.options.projectRoot, filePath)
            .replace(/[\\/]+/g, '/');
    return new InternalAsset({
      idBase,
      value: createAsset({
        idBase,
        filePath: filePath,
        isSource,
        type: path.extname(filePath).slice(1),
        hash,
        env: env,
        stats: {
          time: 0,
          size,
        },
        sideEffects: sideEffects,
      }),
      options: this.options,
      content,
    });
  }
}

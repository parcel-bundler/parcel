// @flow strict-local

import type {WorkerApi} from '@parcel/workers';
import type {
  AssetRequestDesc,
  ConfigRequestDesc,
  ParcelOptions,
  ReportFn,
} from './types';
import type {FilePath, Validator, ValidateResult} from '@parcel/types';

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
  requests: AssetRequestDesc[],
  report: ReportFn,
  workerApi?: WorkerApi,
  dedicatedThread?: boolean,
|};

export default class Validation {
  requests: AssetRequestDesc[];
  configRequests: Array<ConfigRequestDesc>;
  configLoader: ConfigLoader;
  options: ParcelOptions;
  impactfulOptions: $Shape<ParcelOptions>;
  report: ReportFn;
  workerApi: ?WorkerApi;
  /** If true, this Validation instance will run all validators that implement the single-threaded "validateAll" method.
  If false, it will run the one-asset-at-a-time "validate" method. */
  dedicatedThread: boolean;

  constructor({
    requests,
    report,
    options,
    workerApi,
    dedicatedThread,
  }: ValidationOpts) {
    this.configLoader = new ConfigLoader(options);
    this.options = options;
    this.report = report;
    this.requests = requests;
    this.workerApi = workerApi;
    this.dedicatedThread = dedicatedThread ?? false;
  }

  async run(): Promise<void> {
    // Figure out what validators need to be run, and group the assets by the relevant validators.
    let allAssets: {[validatorName: string]: InternalAsset[], ...} = {};
    let allValidators: {
      [validatorName: string]: {|
        name: string,
        plugin: Validator,
        resolveFrom: FilePath,
      |},
      ...,
    } = {};
    let pluginOptions = new PluginOptions(this.options);

    for (let request of this.requests) {
      this.report({
        type: 'validation',
        filePath: request.filePath,
      });

      let asset = await this.loadAsset(request);

      let configRequest = {
        filePath: request.filePath,
        isSource: asset.value.isSource,
        meta: {
          actionType: 'validation',
        },
        env: request.env,
      };

      let config = await this.configLoader.load(configRequest);
      nullthrows(config.result);
      let parcelConfig = new ParcelConfig(
        config.result,
        this.options.packageManager,
      );

      let validators = await parcelConfig.getValidators(request.filePath);
      for (let validator of validators) {
        // ANDREW_TODO: are we sure that the 'validator' object with the same name will be identical?
        allValidators[validator.name] = validator;
        if (allAssets[validator.name]) {
          allAssets[validator.name].push(asset);
        } else {
          allAssets[validator.name] = [asset];
        }
      }
    }

    // ANDREW_TODO: look at ways to maximize parallelization here (with promise.all)?
    for (let validatorName in allValidators) {
      if (allValidators.hasOwnProperty(validatorName)) {
        let validator = allValidators[validatorName];
        let assets = allAssets[validatorName];
        let validatorLogger = new PluginLogger({origin: validator.name});

        if (assets) {
          try {
            let {validateAll, validate} = validator.plugin;
            // If the plugin supports the single-threading validateAll method, pass all assets to it.
            if (validateAll && this.dedicatedThread) {
              let validatorResults = await validateAll({
                assets: assets.map(asset => new Asset(asset)),
                options: pluginOptions,
                logger: validatorLogger,
                resolveConfigWithPath: (
                  configNames: Array<string>,
                  assetFilePath: string,
                ) =>
                  resolveConfig(
                    this.options.inputFS,
                    assetFilePath,
                    configNames,
                  ),
              });
              for (let validatorResult of validatorResults) {
                this.handleResult(validatorResult);
              }
            }

            // Otherwise, pass the assets one-at-a-time
            else if (validate && !this.dedicatedThread) {
              for (let asset of assets) {
                let config = null;
                // ANDREW_TODO: we should have a different version of this for the 'validateAll' case.
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

                let validatorResult = await validate({
                  asset: new Asset(asset),
                  options: pluginOptions,
                  config,
                  logger: validatorLogger,
                });
                this.handleResult(validatorResult);
                // ANDREW_TODO: use Promise.all() to increase performance
              }
            }
          } catch (e) {
            throw new ThrowableDiagnostic({
              diagnostic: errorToDiagnostic(e, validator.name),
            });
          }
        }
      }
    }
  }

  handleResult(validatorResult: ?ValidateResult) {
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
  }

  async loadAsset(request: AssetRequestDesc): Promise<InternalAsset> {
    let {filePath, env, code, sideEffects} = request;
    let {content, size, hash, isSource} = await summarizeRequest(
      this.options.inputFS,
      request,
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

// @flow strict-local

import type {WorkerApi} from '@parcel/workers';
import type {AssetGroup, ParcelOptions, ReportFn} from './types';
import type {ValidateResult, PackagedBundle} from '@parcel/types';

import path from 'path';
import {resolveConfig} from '@parcel/utils';
import {PluginLogger} from '@parcel/logger';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import ParcelConfig from './ParcelConfig';
import UncommittedAsset from './UncommittedAsset';
import {createAsset} from './assetUtils';
import {Asset} from './public/Asset';
import PluginOptions from './public/PluginOptions';
import summarizeRequest from './summarizeRequest';
import {
  type ProjectPath,
  fromProjectPath,
  fromProjectPathRelative,
} from './projectPath';
import BundleGraph from './public/BundleGraph';

export type ValidationMap = {|
  validate: Map<ProjectPath, ValidateResult>,
  validateAll: Array<ValidateResult>,
  validateBundles: Array<ValidateResult>,
|};

export type ValidationOpts = {|
  config: ParcelConfig,
  /**
   * If true, this Validation instance will run all validators that implement the single-threaded "validateAll" method.
   * If falsy, it will run validators that implement the one-asset-at-a-time "validate" method.
   */
  dedicatedThread?: boolean,
  options: ParcelOptions,
  report: ReportFn,
  workerApi?: WorkerApi,
  bundleGraph?: BundleGraph<PackagedBundle>,
|};

export default class Validation {
  impactfulOptions: $Shape<ParcelOptions>;
  options: ParcelOptions;
  parcelConfig: ParcelConfig;
  report: ReportFn;
  requests: AssetGroup[];
  workerApi: ?WorkerApi;

  constructor({config, options, report, workerApi}: ValidationOpts) {
    this.options = options;
    this.parcelConfig = config;
    this.report = report;
    this.workerApi = workerApi;
  }
  async runValidateAsset(assetGroup: AssetGroup): Promise<?ValidateResult> {
    this.report({
      type: 'validation',
      filePath: fromProjectPath(this.options.projectRoot, assetGroup.filePath),
    });
    let pluginOptions = new PluginOptions(this.options);
    let validators = await this.parcelConfig.getValidators();
    let result = (
      await Promise.all(
        validators.map(async validator => {
          let validatorName = validator.name;
          let plugin = validator.plugin;
          let validatorLogger = new PluginLogger({origin: validatorName});

          if (!plugin.validate) {
            return;
          }
          try {
            let config = null;
            let publicAsset = new Asset(await this.loadAsset(assetGroup));
            if (plugin.getConfig) {
              config = await plugin.getConfig({
                asset: publicAsset,
                options: pluginOptions,
                logger: validatorLogger,
                resolveConfig: (configNames: Array<string>) =>
                  resolveConfig(
                    this.options.inputFS,
                    publicAsset.filePath,
                    configNames,
                    this.options.projectRoot,
                  ),
              });
            }

            return plugin.validate({
              asset: publicAsset,
              options: pluginOptions,
              config,
              logger: validatorLogger,
            });
          } catch (e) {
            throw new ThrowableDiagnostic({
              diagnostic: errorToDiagnostic(e, {
                origin: validatorName,
              }),
            });
          }
        }),
      )
    ).filter(Boolean);
    // $FlowFixMe[incompatible-call]
    return combineValidateResults(result);
  }

  async run(
    changedAssets: Array<AssetGroup>,
    bundleGraph: BundleGraph<PackagedBundle>,
  ): Promise<{|
    validateAll: Array<ValidateResult>,
    validateBundles: Array<ValidateResult>,
  |}> {
    let pluginOptions = new PluginOptions(this.options);
    let validators = await this.parcelConfig.getValidators();
    let result = {
      validateAll: [],
      validateBundles: [],
    };

    let assets = await Promise.all(
      changedAssets.map(async a => new Asset(await this.loadAsset(a))),
    );
    await Promise.all(
      validators.map(async validator => {
        let validatorName = validator.name;
        //if (assets) {
        let plugin = validator.plugin;
        let validatorLogger = new PluginLogger({origin: validatorName});
        let validatorResults: Array<?ValidateResult> = [];

        // If the plugin supports the single-threading validateAll method, pass all assets to it.
        if (plugin.validateAll) {
          try {
            // $FlowFixMe[not-a-function]
            let validateAllResults = await plugin.validateAll({
              assets,
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
                  this.options.projectRoot,
                ),
            });
            result.validateAll = validateAllResults;
            validatorResults.push(...validateAllResults); //could this ever be an array ?
          } catch (e) {
            throw new ThrowableDiagnostic({
              diagnostic: errorToDiagnostic(e, {
                origin: validatorName,
              }),
            });
          }
        }

        if (plugin.validateBundles) {
          let validateBundlesResult = await plugin.validateBundles({
            bundleGraph,
            options: pluginOptions,
            logger: validatorLogger,
          });

          validatorResults.push(validateBundlesResult);
          result.validateBundles = [validateBundlesResult];
        }

        // }
      }),
    );
    return result;
  }

  async loadAsset(request: AssetGroup): Promise<UncommittedAsset> {
    let {filePath, env, code, sideEffects, query} = request;
    let {content, size, hash, isSource} = await summarizeRequest(
      this.options.inputFS,
      {
        filePath: fromProjectPath(this.options.projectRoot, request.filePath),
      },
    );

    // If the transformer request passed code rather than a filename,
    // use a hash as the base for the id to ensure it is unique.
    let idBase = code != null ? hash : fromProjectPathRelative(filePath);
    return new UncommittedAsset({
      idBase,
      value: createAsset(this.options.projectRoot, {
        idBase,
        filePath: filePath,
        isSource,
        type: path.extname(fromProjectPathRelative(filePath)).slice(1),
        hash,
        query,
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
export function combineValidateResults(
  validateResults: Array<ValidateResult>,
): ValidateResult {
  return validateResults.reduce(
    (previous, current) => ({
      warnings: previous.warnings.concat(current.warnings),
      errors: previous.errors.concat(current.errors),
    }),
    {warnings: [], errors: []},
  );
}

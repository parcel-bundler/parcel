// @flow strict-local

import type {
  MutableAsset as IMutableAsset,
  FilePath,
  GenerateOutput,
  Transformer,
  TransformerResult,
  PackageName,
} from '@parcel/types';
import type {WorkerApi} from '@parcel/workers';
import type {
  Asset as AssetValue,
  AssetRequestDesc,
  Config,
  ConfigRequestDesc,
  ParcelOptions,
} from './types';

import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {md5FromObject} from '@parcel/utils';
import {PluginLogger} from '@parcel/logger';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';

import ConfigLoader from './ConfigLoader';
import {createDependency} from './Dependency';
import ParcelConfig from './ParcelConfig';
import ResolverRunner from './ResolverRunner';
import {report} from './ReporterRunner';
import {MutableAsset, assetToInternalAsset} from './public/Asset';
import InternalAsset, {createAsset} from './InternalAsset';
import summarizeRequest from './summarizeRequest';
import PluginOptions from './public/PluginOptions';
import {PARCEL_VERSION} from './constants';

type GenerateFunc = (input: IMutableAsset) => Promise<GenerateOutput>;

type PostProcessFunc = (
  Array<InternalAsset>,
) => Promise<Array<InternalAsset> | null>;

export type TransformationOpts = {|
  request: AssetRequestDesc,
  options: ParcelOptions,
  workerApi: WorkerApi,
|};

type ConfigMap = Map<PackageName, Config>;
type ConfigRequestAndResult = {|
  request: ConfigRequestDesc,
  result: Config,
|};

export default class Transformation {
  request: AssetRequestDesc;
  configLoader: ConfigLoader;
  configRequests: Array<ConfigRequestAndResult>;
  options: ParcelOptions;
  impactfulOptions: $Shape<ParcelOptions>;
  workerApi: WorkerApi;
  parcelConfig: ParcelConfig;

  constructor({request, options, workerApi}: TransformationOpts) {
    this.request = request;
    this.configRequests = [];
    this.configLoader = new ConfigLoader(options);
    this.options = options;
    this.workerApi = workerApi;

    // TODO: these options may not impact all transformations, let transformers decide if they care or not
    let {minify, hot, scopeHoist} = this.options;
    this.impactfulOptions = {minify, hot, scopeHoist};
  }

  async loadConfig(configRequest: ConfigRequestDesc) {
    let result = await this.configLoader.load(configRequest);
    this.configRequests.push({request: configRequest, result});
    return result;
  }

  async run(): Promise<{|
    assets: Array<AssetValue>,
    configRequests: Array<ConfigRequestAndResult>,
  |}> {
    report({
      type: 'buildProgress',
      phase: 'transforming',
      filePath: this.request.filePath,
    });

    let asset = await this.loadAsset();
    let pipeline = await this.loadPipeline(
      this.request.filePath,
      asset.value.isSource,
      this.request.pipeline,
    );
    let results = await this.runPipelines(pipeline, asset);
    let assets = results.map(a => a.value);

    for (let {request, result} of this.configRequests) {
      let plugin =
        request.plugin != null &&
        (await this.parcelConfig.loadPlugin(request.plugin));
      if (plugin && plugin.preSerializeConfig) {
        plugin.preSerializeConfig({config: result});
      }
    }
    return {assets, configRequests: this.configRequests};
  }

  async loadAsset(): Promise<InternalAsset> {
    let {filePath, env, code, pipeline, sideEffects} = this.request;
    let {content, size, hash, isSource} = await summarizeRequest(
      this.options.inputFS,
      this.request,
    );

    // If the transformer request passed code rather than a filename,
    // use a hash as the base for the id to ensure it is unique.
    let idBase = code != null ? hash : filePath;
    return new InternalAsset({
      idBase,
      value: createAsset({
        idBase,
        filePath,
        isSource,
        type: path.extname(filePath).slice(1),
        hash,
        pipeline,
        env,
        stats: {
          time: 0,
          size,
        },
        sideEffects,
      }),
      options: this.options,
      content,
    });
  }

  async runPipelines(
    pipeline: Pipeline,
    initialAsset: InternalAsset,
  ): Promise<Array<InternalAsset>> {
    let initialType = initialAsset.value.type;
    let initialAssetCacheKey = this.getCacheKey(
      [initialAsset],
      pipeline.configs,
    );
    let initialCacheEntry = await this.readFromCache(initialAssetCacheKey);

    let assets =
      initialCacheEntry || (await this.runPipeline(pipeline, initialAsset));
    if (!initialCacheEntry) {
      await this.writeToCache(initialAssetCacheKey, assets, pipeline.configs);
    }

    let finalAssets: Array<InternalAsset> = [];
    for (let asset of assets) {
      let nextPipeline;
      if (asset.value.type !== initialType) {
        nextPipeline = await this.loadNextPipeline({
          filePath: initialAsset.value.filePath,
          isSource: asset.value.isSource,
          nextType: asset.value.type,
          currentPipeline: pipeline,
        });
      }

      if (nextPipeline) {
        let nextPipelineAssets = await this.runPipelines(nextPipeline, asset);
        finalAssets = finalAssets.concat(nextPipelineAssets);
      } else {
        finalAssets.push(asset);
      }
    }

    if (!pipeline.postProcess) {
      return finalAssets;
    }

    let processedCacheEntry = await this.readFromCache(
      this.getCacheKey(finalAssets, pipeline.configs),
    );

    invariant(pipeline.postProcess != null);
    let processedFinalAssets: Array<InternalAsset> =
      processedCacheEntry ?? (await pipeline.postProcess(finalAssets)) ?? [];

    if (!processedCacheEntry) {
      await this.writeToCache(
        this.getCacheKey(processedFinalAssets, pipeline.configs),
        processedFinalAssets,
        pipeline.configs,
      );
    }

    return processedFinalAssets;
  }

  async runPipeline(
    pipeline: Pipeline,
    initialAsset: InternalAsset,
  ): Promise<Array<InternalAsset>> {
    let initialType = initialAsset.value.type;
    let inputAssets = [initialAsset];
    let resultingAssets;
    let finalAssets = [];
    for (let transformer of pipeline.transformers) {
      resultingAssets = [];
      for (let asset of inputAssets) {
        if (
          asset.value.type !== initialType &&
          (await this.loadNextPipeline({
            filePath: initialAsset.value.filePath,
            isSource: asset.value.isSource,
            nextType: asset.value.type,
            currentPipeline: pipeline,
          }))
        ) {
          finalAssets.push(asset);
          continue;
        }

        try {
          let transformerResults = await runTransformer(
            pipeline,
            asset,
            transformer.plugin,
            transformer.name,
            transformer.config,
          );

          for (let result of transformerResults) {
            resultingAssets.push(asset.createChildAsset(result));
          }
        } catch (e) {
          throw new ThrowableDiagnostic({
            diagnostic: errorToDiagnostic(e, transformer.name),
          });
        }
      }
      inputAssets = resultingAssets;
    }

    finalAssets = finalAssets.concat(resultingAssets);

    return Promise.all(
      finalAssets.map(asset =>
        finalize(nullthrows(asset), nullthrows(pipeline.generate)),
      ),
    );
  }

  async readFromCache(cacheKey: string): Promise<null | Array<InternalAsset>> {
    if (this.options.disableCache || this.request.code != null) {
      return null;
    }

    let cachedAssets = await this.options.cache.get(cacheKey);
    if (!cachedAssets) {
      return null;
    }

    return cachedAssets.map(
      (value: AssetValue) =>
        new InternalAsset({
          value,
          options: this.options,
        }),
    );
  }

  async writeToCache(
    cacheKey: string,
    assets: Array<InternalAsset>,
    configs: ConfigMap,
  ): Promise<void> {
    await Promise.all(
      // TODO: account for impactfulOptions maybe being different per pipeline
      assets.map(asset =>
        asset.commit(
          md5FromObject({
            impactfulOptions: this.impactfulOptions,
            configs: getImpactfulConfigInfo(configs),
          }),
        ),
      ),
    );
    this.options.cache.set(
      cacheKey,
      assets.map(a => a.value),
    );
  }

  getCacheKey(assets: Array<InternalAsset>, configs: ConfigMap): string {
    let assetsKeyInfo = assets.map(a => ({
      filePath: a.value.filePath,
      hash: a.value.hash,
    }));

    return md5FromObject({
      parcelVersion: PARCEL_VERSION,
      assets: assetsKeyInfo,
      configs: getImpactfulConfigInfo(configs),
      env: this.request.env,
      impactfulOptions: this.impactfulOptions,
    });
  }

  async loadPipeline(
    filePath: FilePath,
    isSource: boolean,
    pipelineName?: ?string,
  ): Promise<Pipeline> {
    let configRequest = {
      filePath,
      env: this.request.env,
      isSource,
      pipeline: pipelineName,
      meta: {
        actionType: 'transformation',
      },
    };
    let configs = new Map();

    let config = await this.loadConfig(configRequest);
    let result = nullthrows(config.result);
    let parcelConfig = new ParcelConfig(
      config.result,
      this.options.packageManager,
    );
    // A little hacky
    this.parcelConfig = parcelConfig;

    configs.set('parcel', config);

    for (let [moduleName] of config.devDeps) {
      let plugin = await parcelConfig.loadPlugin(moduleName);
      // TODO: implement loadPlugin in existing plugins that require config
      if (plugin.loadConfig) {
        let thirdPartyConfig = await this.loadTransformerConfig({
          filePath,
          plugin: moduleName,
          parcelConfigPath: result.filePath,
          isSource,
        });

        configs.set(moduleName, thirdPartyConfig);
      }
    }

    let transformers = await parcelConfig.getTransformers(
      filePath,
      pipelineName,
    );
    let pipeline = {
      id: transformers.map(t => t.name).join(':'),

      transformers: transformers.map(transformer => ({
        name: transformer.name,
        config: configs.get(transformer.name)?.result,
        plugin: transformer.plugin,
      })),
      configs,
      options: this.options,
      resolverRunner: new ResolverRunner({
        config: new ParcelConfig(
          nullthrows(nullthrows(configs.get('parcel')).result),
          this.options.packageManager,
        ),
        options: this.options,
      }),

      pluginOptions: new PluginOptions(this.options),
      workerApi: this.workerApi,
    };

    return pipeline;
  }

  async loadNextPipeline({
    filePath,
    isSource,
    nextType,
    currentPipeline,
  }: {|
    filePath: string,
    isSource: boolean,
    nextType: string,
    currentPipeline: Pipeline,
  |}): Promise<?Pipeline> {
    let nextFilePath =
      filePath.slice(0, -path.extname(filePath).length) + '.' + nextType;
    let nextPipeline = await this.loadPipeline(
      nextFilePath,
      isSource,
      this.request.pipeline,
    );

    if (nextPipeline.id === currentPipeline.id) {
      return null;
    }

    return nextPipeline;
  }

  loadTransformerConfig({
    filePath,
    plugin,
    parcelConfigPath,
    isSource,
  }: {|
    filePath: FilePath,
    plugin: PackageName,
    parcelConfigPath: FilePath,
    isSource: boolean,
  |}): Promise<Config> {
    let configRequest = {
      filePath,
      env: this.request.env,
      plugin,
      isSource,
      meta: {
        parcelConfigPath,
      },
    };
    return this.loadConfig(configRequest);
  }
}

type Pipeline = {|
  id: string,
  transformers: Array<TransformerWithNameAndConfig>,
  configs: ConfigMap,
  options: ParcelOptions,
  pluginOptions: PluginOptions,
  resolverRunner: ResolverRunner,
  workerApi: WorkerApi,
  postProcess?: PostProcessFunc,
  generate?: GenerateFunc,
|};

type TransformerWithNameAndConfig = {|
  name: PackageName,
  plugin: Transformer,
  config: ?Config,
|};

async function runTransformer(
  pipeline: Pipeline,
  asset: InternalAsset,
  transformer: Transformer,
  transformerName: string,
  preloadedConfig: ?Config,
): Promise<Array<TransformerResult>> {
  const logger = new PluginLogger({origin: transformerName});

  const resolve = async (from: FilePath, to: string): Promise<FilePath> => {
    return nullthrows(
      await pipeline.resolverRunner.resolve(
        createDependency({
          env: asset.value.env,
          moduleSpecifier: to,
          sourcePath: from,
        }),
      ),
    ).filePath;
  };

  // Load config for the transformer.
  let config = preloadedConfig;
  if (transformer.getConfig) {
    // TODO: deprecate getConfig
    config = await transformer.getConfig({
      asset: new MutableAsset(asset),
      options: pipeline.pluginOptions,
      resolve,
      logger,
    });
  }

  // If an ast exists on the asset, but we cannot reuse it,
  // use the previous transform to generate code that we can re-parse.
  if (
    asset.ast &&
    (!transformer.canReuseAST ||
      !transformer.canReuseAST({
        ast: asset.ast,
        options: pipeline.pluginOptions,
        logger,
      })) &&
    pipeline.generate
  ) {
    let output = await pipeline.generate(new MutableAsset(asset));
    asset.content = output.code;
    asset.ast = null;
  }

  // Parse if there is no AST available from a previous transform.
  if (!asset.ast && transformer.parse) {
    asset.ast = await transformer.parse({
      asset: new MutableAsset(asset),
      config,
      options: pipeline.pluginOptions,
      resolve,
      logger,
    });
  }

  // Transform.
  let results = await normalizeAssets(
    // $FlowFixMe
    await transformer.transform({
      asset: new MutableAsset(asset),
      config,
      options: pipeline.pluginOptions,
      resolve,
      logger,
    }),
  );

  // Create generate and postProcess functions that can be called later
  pipeline.generate = (input: IMutableAsset): Promise<GenerateOutput> => {
    if (transformer.generate) {
      return Promise.resolve(
        transformer.generate({
          asset: input,
          config,
          options: pipeline.pluginOptions,
          resolve,
          logger,
        }),
      );
    }

    throw new Error(
      'Asset has an AST but no generate method is available on the transform',
    );
  };

  // For Flow
  let postProcess = transformer.postProcess;
  if (postProcess) {
    pipeline.postProcess = async (
      assets: Array<InternalAsset>,
    ): Promise<Array<InternalAsset> | null> => {
      let results = await postProcess.call(transformer, {
        assets: assets.map(asset => new MutableAsset(asset)),
        config,
        options: pipeline.pluginOptions,
        resolve,
        logger,
      });

      return Promise.all(results.map(result => asset.createChildAsset(result)));
    };
  }

  return results;
}

async function finalize(
  asset: InternalAsset,
  generate: GenerateFunc,
): Promise<InternalAsset> {
  if (asset.ast && generate) {
    let result = await generate(new MutableAsset(asset));
    return asset.createChildAsset({
      type: asset.value.type,
      uniqueKey: asset.value.uniqueKey,
      ...result,
    });
  }
  return asset;
}

function normalizeAssets(
  results: Array<TransformerResult | MutableAsset>,
): Array<TransformerResult> {
  return results.map(result => {
    if (!(result instanceof MutableAsset)) {
      return result;
    }

    let internalAsset = assetToInternalAsset(result);
    return {
      type: result.type,
      content: internalAsset.content,
      ast: result.ast,
      map: internalAsset.map,
      // $FlowFixMe
      dependencies: [...internalAsset.value.dependencies.values()],
      includedFiles: result.getIncludedFiles(),
      // $FlowFixMe
      env: result.env,
      isIsolated: result.isIsolated,
      isInline: result.isInline,
      pipeline: internalAsset.value.pipeline,
      meta: result.meta,
      uniqueKey: internalAsset.value.uniqueKey,
    };
  });
}

function getImpactfulConfigInfo(configs: ConfigMap) {
  let impactfulConfigInfo = {};

  for (let [configType, {devDeps, resultHash}] of configs) {
    let devDepsObject = {};

    for (let [moduleName, version] of devDeps) {
      devDepsObject[moduleName] = version;
    }

    impactfulConfigInfo[configType] = {
      devDeps: devDepsObject,
      resultHash,
    };
  }

  return impactfulConfigInfo;
}

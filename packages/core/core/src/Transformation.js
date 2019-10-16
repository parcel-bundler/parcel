// @flow strict-local

import type {
  MutableAsset as IMutableAsset,
  FilePath,
  GenerateOutput,
  Transformer,
  TransformerResult,
  PackageName
} from '@parcel/types';
import type {
  Asset as AssetValue,
  AssetRequest,
  Config,
  NodeId,
  ConfigRequest,
  ParcelOptions
} from './types';
import type {WorkerApi} from '@parcel/workers';

import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {md5FromObject} from '@parcel/utils';

import {createDependency} from './Dependency';
import PublicConfig from './public/Config';
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
  Array<InternalAsset>
) => Promise<Array<InternalAsset> | null>;

export type TransformationOpts = {|
  request: AssetRequest,
  loadConfig: (ConfigRequest, NodeId) => Promise<Config>,
  parentNodeId: NodeId,
  options: ParcelOptions,
  workerApi: WorkerApi
|};

type ConfigMap = Map<PackageName, Config>;

export default class Transformation {
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
  }: TransformationOpts) {
    this.request = request;
    this.configRequests = [];
    this.loadConfig = configRequest => {
      this.configRequests.push(configRequest);
      return loadConfig(configRequest, parentNodeId);
    };
    this.options = options;
    this.workerApi = workerApi;

    // TODO: these options may not impact all transformations, let transformers decide if they care or not
    let {minify, hot, scopeHoist} = this.options;
    this.impactfulOptions = {minify, hot, scopeHoist};
  }

  async run(): Promise<{
    assets: Array<AssetValue>,
    configRequests: Array<ConfigRequest>,
    ...
  }> {
    report({
      type: 'buildProgress',
      phase: 'transforming',
      filePath: this.request.filePath
    });

    let asset = await this.loadAsset();
    let pipeline = await this.loadPipeline(
      this.request.filePath,
      asset.value.isSource,
      this.request.pipeline
    );
    let results = await this.runPipeline(pipeline, asset);
    let assets = results.map(a => a.value);

    return {assets, configRequests: this.configRequests};
  }

  async loadAsset(): Promise<InternalAsset> {
    let {filePath, env, code, sideEffects} = this.request;
    let {content, size, hash, isSource} = await summarizeRequest(
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
        filePath,
        isSource,
        type: path.extname(filePath).slice(1),
        hash,
        env,
        stats: {
          time: 0,
          size
        },
        sideEffects
      }),
      options: this.options,
      content
    });
  }

  async runPipeline(
    pipeline: Pipeline,
    initialAsset: InternalAsset
  ): Promise<Array<InternalAsset>> {
    let initialType = initialAsset.value.type;
    let initialAssetCacheKey = this.getCacheKey(
      [initialAsset],
      pipeline.configs
    );
    // TODO: is this reading/writing from the cache every time we jump a pipeline? Seems possibly unnecessary...
    let initialCacheEntry = await this.readFromCache(initialAssetCacheKey);

    let assets = initialCacheEntry || (await pipeline.transform(initialAsset));
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
          currentPipeline: pipeline
        });
      }

      if (nextPipeline) {
        let nextPipelineAssets = await this.runPipeline(nextPipeline, asset);
        finalAssets = finalAssets.concat(nextPipelineAssets);
      } else {
        finalAssets.push(asset);
      }
    }

    if (!pipeline.postProcess) {
      return finalAssets;
    }

    let processedCacheEntry = await this.readFromCache(
      this.getCacheKey(finalAssets, pipeline.configs)
    );

    invariant(pipeline.postProcess != null);
    let processedFinalAssets: Array<InternalAsset> =
      processedCacheEntry ?? (await pipeline.postProcess(assets)) ?? [];

    if (!processedCacheEntry) {
      await this.writeToCache(
        this.getCacheKey(processedFinalAssets, pipeline.configs),
        processedFinalAssets,
        pipeline.configs
      );
    }

    return processedFinalAssets;
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
          options: this.options
        })
    );
  }

  async writeToCache(
    cacheKey: string,
    assets: Array<InternalAsset>,
    configs: ConfigMap
  ): Promise<void> {
    await Promise.all(
      // TODO: account for impactfulOptions maybe being different per pipeline
      assets.map(asset =>
        asset.commit(
          md5FromObject({
            impactfulOptions: this.impactfulOptions,
            configs: getImpactfulConfigInfo(configs)
          })
        )
      )
    );
    this.options.cache.set(cacheKey, assets.map(a => a.value));
  }

  getCacheKey(assets: Array<InternalAsset>, configs: ConfigMap): string {
    let assetsKeyInfo = assets.map(a => ({
      filePath: a.value.filePath,
      hash: a.value.hash
    }));

    return md5FromObject({
      parcelVersion: PARCEL_VERSION,
      assets: assetsKeyInfo,
      configs: getImpactfulConfigInfo(configs),
      env: this.request.env,
      impactfulOptions: this.impactfulOptions
    });
  }

  async loadPipeline(
    filePath: FilePath,
    isSource: boolean,
    pipelineName?: ?string
  ): Promise<Pipeline> {
    let configRequest = {
      filePath,
      env: this.request.env,
      isSource,
      pipeline: pipelineName,
      meta: {
        actionType: 'transformation'
      }
    };
    let configs = new Map();

    let config = await this.loadConfig(configRequest);
    let result = nullthrows(config.result);
    let parcelConfig = new ParcelConfig(
      config.result,
      this.options.packageManager
    );

    configs.set('parcel', config);

    for (let [moduleName] of config.devDeps) {
      let plugin = await parcelConfig.loadPlugin(moduleName);
      // TODO: implement loadPlugin in existing plugins that require config
      if (plugin.loadConfig) {
        let thirdPartyConfig = await this.loadTransformerConfig({
          filePath,
          plugin: moduleName,
          parcelConfigPath: result.filePath,
          isSource
        });

        let config = new PublicConfig(thirdPartyConfig, this.options);
        if (thirdPartyConfig.shouldRehydrate) {
          await plugin.rehydrateConfig({
            config,
            options: this.options
          });
        } else if (thirdPartyConfig.shouldReload) {
          await plugin.loadConfig({
            config,
            options: this.options
          });
        }

        configs.set(moduleName, thirdPartyConfig);
      }
    }

    let pipeline = new Pipeline({
      names: parcelConfig.getTransformerNames(filePath, pipelineName),
      plugins: await parcelConfig.getTransformers(filePath, pipelineName),
      configs,
      options: this.options,
      workerApi: this.workerApi
    });

    return pipeline;
  }

  async loadNextPipeline({
    filePath,
    isSource,
    nextType,
    currentPipeline
  }: {|
    filePath: string,
    isSource: boolean,
    nextType: string,
    currentPipeline: Pipeline
  |}): Promise<?Pipeline> {
    let nextFilePath =
      filePath.slice(0, -path.extname(filePath).length) + '.' + nextType;
    let nextPipeline = await this.loadPipeline(
      nextFilePath,
      isSource,
      this.request.pipeline
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
    isSource
  }: {|
    filePath: FilePath,
    plugin: PackageName,
    parcelConfigPath: FilePath,
    isSource: boolean
  |}): Promise<Config> {
    let configRequest = {
      filePath,
      env: this.request.env,
      plugin,
      isSource,
      meta: {
        parcelConfigPath
      }
    };
    return this.loadConfig(configRequest);
  }
}

type PipelineOpts = {|
  names: Array<PackageName>,
  plugins: Array<Transformer>,
  configs: ConfigMap,
  options: ParcelOptions,
  workerApi: WorkerApi
|};

type TransformerWithNameAndConfig = {|
  name: PackageName,
  plugin: Transformer,
  config: ?Config
|};

class Pipeline {
  id: string;
  transformers: Array<TransformerWithNameAndConfig>;
  configs: ConfigMap;
  options: ParcelOptions;
  pluginOptions: PluginOptions;
  resolverRunner: ResolverRunner;
  generate: GenerateFunc;
  postProcess: ?PostProcessFunc;
  workerApi: WorkerApi;

  constructor({names, plugins, configs, options, workerApi}: PipelineOpts) {
    this.id = names.join(':');

    this.transformers = names.map((name, i) => ({
      name,
      config: configs.get(name)?.result,
      plugin: plugins[i]
    }));
    this.configs = configs;
    this.options = options;
    let parcelConfig = new ParcelConfig(
      nullthrows(nullthrows(this.configs.get('parcel')).result),
      this.options.packageManager
    );
    this.resolverRunner = new ResolverRunner({
      config: parcelConfig,
      options
    });

    this.pluginOptions = new PluginOptions(this.options);
    this.workerApi = workerApi;
  }

  async transform(initialAsset: InternalAsset): Promise<Array<InternalAsset>> {
    let initialType = initialAsset.value.type;
    let inputAssets = [initialAsset];
    let resultingAssets;
    let finalAssets = [];
    for (let transformer of this.transformers) {
      resultingAssets = [];
      for (let asset of inputAssets) {
        // TODO: I think there may be a bug here if the type changes but does not
        // change pipelines (e.g. .html -> .htm). It should continue on the same
        // pipeline in that case.
        if (asset.value.type !== initialType) {
          finalAssets.push(asset);
        } else {
          let transformerResults = await this.runTransformer(
            asset,
            transformer.plugin,
            transformer.config
          );
          for (let result of transformerResults) {
            resultingAssets.push(asset.createChildAsset(result));
          }
        }
      }
      inputAssets = resultingAssets;
    }

    finalAssets = finalAssets.concat(resultingAssets);

    return Promise.all(
      finalAssets.map(asset => finalize(nullthrows(asset), this.generate))
    );
  }

  async runTransformer(
    asset: InternalAsset,
    transformer: Transformer,
    preloadedConfig: ?Config
  ): Promise<Array<TransformerResult>> {
    const resolve = async (from: FilePath, to: string): Promise<FilePath> => {
      return nullthrows(
        await this.resolverRunner.resolve(
          createDependency({
            env: asset.value.env,
            moduleSpecifier: to,
            sourcePath: from
          })
        )
      ).filePath;
    };

    // Load config for the transformer.
    let config = preloadedConfig;
    if (transformer.getConfig) {
      // TODO: deprecate getConfig
      config = await transformer.getConfig({
        asset: new MutableAsset(asset),
        options: this.pluginOptions,
        resolve
      });
    }

    // If an ast exists on the asset, but we cannot reuse it,
    // use the previous transform to generate code that we can re-parse.
    if (
      asset.ast &&
      (!transformer.canReuseAST ||
        !transformer.canReuseAST({
          ast: asset.ast,
          options: this.pluginOptions
        })) &&
      this.generate
    ) {
      let output = await this.generate(new MutableAsset(asset));
      asset.content = output.code;
      asset.ast = null;
    }

    // Parse if there is no AST available from a previous transform.
    if (!asset.ast && transformer.parse) {
      asset.ast = await transformer.parse({
        asset: new MutableAsset(asset),
        config,
        options: this.pluginOptions,
        resolve
      });
    }

    // Transform.
    let results = await normalizeAssets(
      // $FlowFixMe
      await transformer.transform({
        asset: new MutableAsset(asset),
        config,
        options: this.pluginOptions,
        resolve
      })
    );

    // Create generate and postProcess functions that can be called later
    this.generate = (input: IMutableAsset): Promise<GenerateOutput> => {
      if (transformer.generate) {
        return Promise.resolve(
          transformer.generate({
            asset: input,
            config,
            options: this.pluginOptions,
            resolve
          })
        );
      }

      throw new Error(
        'Asset has an AST but no generate method is available on the transform'
      );
    };

    // For Flow
    let postProcess = transformer.postProcess;
    if (postProcess) {
      this.postProcess = async (
        assets: Array<InternalAsset>
      ): Promise<Array<InternalAsset> | null> => {
        let results = await postProcess.call(transformer, {
          assets: assets.map(asset => new MutableAsset(asset)),
          config,
          options: this.pluginOptions,
          resolve
        });

        return Promise.all(
          results.map(result => asset.createChildAsset(result))
        );
      };
    }

    return results;
  }
}

async function finalize(
  asset: InternalAsset,
  generate: GenerateFunc
): Promise<InternalAsset> {
  if (asset.ast && generate) {
    let result = await generate(new MutableAsset(asset));
    return asset.createChildAsset({
      type: asset.value.type,
      uniqueKey: asset.value.uniqueKey,
      ...result
    });
  }
  return asset;
}

function normalizeAssets(
  results: Array<TransformerResult | MutableAsset>
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
      meta: result.meta,
      uniqueKey: internalAsset.value.uniqueKey
    };
  });
}

function getImpactfulConfigInfo(configs: ConfigMap) {
  return [...configs].map(([, {resultHash, devDeps}]) => ({
    resultHash,
    devDeps: [...devDeps]
  }));
}

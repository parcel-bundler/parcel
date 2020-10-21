// @flow strict-local

import type {
  FilePath,
  GenerateOutput,
  Transformer,
  TransformerResult,
  PackageName,
} from '@parcel/types';
import type {WorkerApi} from '@parcel/workers';
import type {
  Asset as AssetValue,
  AssetRequestInput,
  RequestInvalidation,
  Config,
  ConfigRequestDesc,
  ParcelOptions,
  ReportFn,
} from './types';

import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {
  escapeMarkdown,
  md5FromObject,
  normalizeSeparators,
} from '@parcel/utils';
import logger, {PluginLogger} from '@parcel/logger';
import {init as initSourcemaps} from '@parcel/source-map';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import {SOURCEMAP_EXTENSIONS, flatMap} from '@parcel/utils';

import ConfigLoader from './ConfigLoader';
import {createDependency} from './Dependency';
import ParcelConfig from './ParcelConfig';
// TODO: eventually call path request as sub requests
import {ResolverRunner} from './requests/PathRequest';
import {
  Asset,
  MutableAsset,
  mutableAssetToUncommittedAsset,
} from './public/Asset';
import UncommittedAsset from './UncommittedAsset';
import {createAsset, getInvalidationHash} from './assetUtils';
import summarizeRequest from './summarizeRequest';
import PluginOptions from './public/PluginOptions';
import {PARCEL_VERSION} from './constants';

type GenerateFunc = (input: UncommittedAsset) => Promise<GenerateOutput>;

type PostProcessFunc = (
  Array<UncommittedAsset>,
) => Promise<Array<UncommittedAsset> | null>;

export type TransformationOpts = {|
  options: ParcelOptions,
  config: ParcelConfig,
  report: ReportFn,
  request: AssetRequestInput,
  workerApi: WorkerApi,
|};

export type TransformationResult = {|
  assets: Array<AssetValue>,
  configRequests: Array<ConfigRequestAndResult>,
  invalidations: Array<RequestInvalidation>,
|};

type ConfigMap = Map<PackageName, Config>;
type ConfigRequestAndResult = {|
  request: ConfigRequestDesc,
  result: Config,
|};

export default class Transformation {
  request: AssetRequestInput;
  configLoader: ConfigLoader;
  configRequests: Array<ConfigRequestAndResult>;
  options: ParcelOptions;
  impactfulOptions: $Shape<ParcelOptions>;
  workerApi: WorkerApi;
  parcelConfig: ParcelConfig;
  report: ReportFn;
  invalidations: Map<string, RequestInvalidation>;

  constructor({
    report,
    request,
    options,
    config,
    workerApi,
  }: TransformationOpts) {
    this.configRequests = [];
    this.configLoader = new ConfigLoader({options, config});
    this.parcelConfig = config;
    this.options = options;
    this.report = report;
    this.request = request;
    this.workerApi = workerApi;
    this.invalidations = new Map();

    // TODO: these options may not impact all transformations, let transformers decide if they care or not
    let {hot} = this.options;
    this.impactfulOptions = {hot};
  }

  async loadConfig(configRequest: ConfigRequestDesc): Promise<Config> {
    let result = await this.configLoader.load(configRequest);
    this.configRequests.push({request: configRequest, result});
    return result;
  }

  async run(): Promise<TransformationResult> {
    await initSourcemaps;

    this.report({
      type: 'buildProgress',
      phase: 'transforming',
      filePath: this.request.filePath,
    });

    let asset = await this.loadAsset();

    // Load existing sourcemaps
    if (SOURCEMAP_EXTENSIONS.has(asset.value.type)) {
      try {
        await asset.loadExistingSourcemap();
      } catch (err) {
        logger.verbose([
          {
            origin: '@parcel/core',
            message: `Could not load existing source map for ${escapeMarkdown(
              path.relative(this.options.projectRoot, asset.value.filePath),
            )}`,
            filePath: asset.value.filePath,
          },
          {
            origin: '@parcel/core',
            message: escapeMarkdown(err.message),
            filePath: asset.value.filePath,
          },
        ]);
      }
    }

    let pipeline = await this.loadPipeline(
      this.request.filePath,
      asset.value.isSource,
      this.request,
    );
    let results = await this.runPipelines(pipeline, asset);
    let assets = results.map(a => a.value);

    for (let {request, result} of this.configRequests) {
      if (request.plugin != null) {
        let resolveFrom = request.meta.parcelConfigPath;
        let keyPath = request.meta.parcelConfigKeyPath;
        invariant(
          typeof resolveFrom === 'string',
          'request.meta.parcelConfigPath should be a string!',
        );
        invariant(
          typeof keyPath === 'string',
          'request.meta.parcelConfigKeyPath should be a string!',
        );

        let {plugin} = await this.parcelConfig.loadPlugin({
          packageName: request.plugin,
          resolveFrom,
          keyPath,
        });

        if (plugin && plugin.preSerializeConfig) {
          plugin.preSerializeConfig({config: result});
        }
      }
    }

    return {
      assets,
      configRequests: this.configRequests,
      invalidations: [...this.invalidations.values()],
    };
  }

  async loadAsset(): Promise<UncommittedAsset> {
    let {
      filePath,
      env,
      code,
      pipeline,
      isSource: isSourceOverride,
      sideEffects,
      query,
    } = this.request;
    let {
      content,
      size,
      hash,
      isSource: summarizedIsSource,
    } = await summarizeRequest(this.options.inputFS, {filePath, code});

    // Prefer `isSource` originating from the AssetRequest.
    let isSource = isSourceOverride ?? summarizedIsSource;

    // If the transformer request passed code rather than a filename,
    // use a hash as the base for the id to ensure it is unique.
    let idBase =
      code != null
        ? hash
        : normalizeSeparators(
            path.relative(this.options.projectRoot, filePath),
          );
    return new UncommittedAsset({
      idBase,
      value: createAsset({
        idBase,
        filePath,
        isSource,
        type: path.extname(filePath).slice(1),
        hash,
        pipeline,
        env,
        query,
        stats: {
          time: 0,
          size,
        },
        sideEffects,
      }),
      options: this.options,
      content,
      invalidations: this.invalidations,
    });
  }

  async runPipelines(
    pipeline: Pipeline,
    initialAsset: UncommittedAsset,
  ): Promise<Array<UncommittedAsset>> {
    let initialType = initialAsset.value.type;
    let initialAssetCacheKey = this.getCacheKey(
      [initialAsset],
      pipeline.configs,
      await getInvalidationHash(this.request.invalidations || [], this.options),
    );
    let initialCacheEntry = await this.readFromCache(initialAssetCacheKey);

    let assets =
      initialCacheEntry || (await this.runPipeline(pipeline, initialAsset));

    if (!initialCacheEntry) {
      let resultCacheKey = this.getCacheKey(
        [initialAsset],
        pipeline.configs,
        await getInvalidationHash(
          flatMap(assets, asset => asset.getInvalidations()),
          this.options,
        ),
      );
      await this.writeToCache(resultCacheKey, assets, pipeline.configs);
    }

    let finalAssets: Array<UncommittedAsset> = [];
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
      this.getCacheKey(
        finalAssets,
        pipeline.configs,
        await getInvalidationHash(
          flatMap(finalAssets, asset => asset.getInvalidations()),
          this.options,
        ),
      ),
    );

    invariant(pipeline.postProcess != null);
    let processedFinalAssets: Array<UncommittedAsset> =
      processedCacheEntry ?? (await pipeline.postProcess(finalAssets)) ?? [];

    if (!processedCacheEntry) {
      await this.writeToCache(
        this.getCacheKey(
          processedFinalAssets,
          pipeline.configs,
          await getInvalidationHash(
            flatMap(processedFinalAssets, asset => asset.getInvalidations()),
            this.options,
          ),
        ),
        processedFinalAssets,
        pipeline.configs,
      );
    }

    return processedFinalAssets;
  }

  async runPipeline(
    pipeline: Pipeline,
    initialAsset: UncommittedAsset,
  ): Promise<Array<UncommittedAsset>> {
    if (pipeline.transformers.length === 0) {
      return [initialAsset];
    }

    let initialType = initialAsset.value.type;
    let inputAssets = [initialAsset];
    let resultingAssets = [];
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
            transformer.configKeyPath,
            this.parcelConfig,
          );

          for (let result of transformerResults) {
            resultingAssets.push(
              asset.createChildAsset(
                result,
                transformer.name,
                this.parcelConfig.filePath,
                transformer.configKeyPath,
              ),
            );
          }
        } catch (e) {
          throw new ThrowableDiagnostic({
            diagnostic: errorToDiagnostic(e, transformer.name),
          });
        }
      }
      inputAssets = resultingAssets;
    }

    // Make assets with ASTs generate unless they are js assets and target uses
    // scope hoisting. This parallelizes generation and distributes work more
    // evenly across workers than if one worker needed to generate all assets in
    // a large bundle during packaging.
    let generate = pipeline.generate;
    if (generate != null) {
      await Promise.all(
        resultingAssets
          .filter(
            asset =>
              asset.ast != null &&
              !(asset.value.type === 'js' && asset.value.env.scopeHoist),
          )
          .map(async asset => {
            if (asset.isASTDirty) {
              let output = await generate(asset);
              asset.content = output.content;
              asset.mapBuffer = output.map?.toBuffer();
            }

            asset.clearAST();
          }),
      );
    }

    return finalAssets.concat(resultingAssets);
  }

  async readFromCache(cacheKey: string): Promise<?Array<UncommittedAsset>> {
    if (this.options.disableCache || this.request.code != null) {
      return null;
    }

    let cachedAssets = await this.options.cache.get<Array<AssetValue>>(
      cacheKey,
    );
    if (!cachedAssets) {
      return null;
    }

    return cachedAssets.map(
      (value: AssetValue) =>
        new UncommittedAsset({
          value,
          options: this.options,
        }),
    );
  }

  async writeToCache(
    cacheKey: string,
    assets: Array<UncommittedAsset>,
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

  getCacheKey(
    assets: Array<UncommittedAsset>,
    configs: ConfigMap,
    invalidationHash: string,
  ): string {
    let assetsKeyInfo = assets.map(a => ({
      filePath: a.value.filePath,
      pipeline: a.value.pipeline,
      hash: a.value.hash,
      uniqueKey: a.value.uniqueKey,
    }));

    return md5FromObject({
      parcelVersion: PARCEL_VERSION,
      assets: assetsKeyInfo,
      configs: getImpactfulConfigInfo(configs),
      env: this.request.env,
      impactfulOptions: this.impactfulOptions,
      invalidationHash,
    });
  }

  async loadPipeline(
    filePath: FilePath,
    isSource: boolean,
    request?: AssetRequestInput,
  ): Promise<Pipeline> {
    let configRequest = {
      filePath,
      env: this.request.env,
      isSource,
      pipeline: request?.pipeline,
      isURL: request?.isURL,
      meta: {
        actionType: 'transformation',
      },
    };
    let configs = new Map();

    let config = await this.loadConfig(configRequest);

    configs.set('parcel', config);

    let transformers = await this.parcelConfig.getTransformers(
      filePath,
      request?.pipeline,
      request?.isURL,
    );

    for (let {name, resolveFrom, keyPath} of transformers) {
      let thirdPartyConfig = await this.loadTransformerConfig({
        filePath,
        plugin: name,
        parcelConfigPath: resolveFrom,
        parcelConfigKeyPath: keyPath,
        isSource,
      });

      configs.set(name, thirdPartyConfig);
    }

    let pipeline = {
      id: transformers.map(t => t.name).join(':'),
      transformers: transformers.map(transformer => ({
        name: transformer.name,
        config: configs.get(transformer.name)?.result,
        configKeyPath: transformer.keyPath,
        plugin: transformer.plugin,
      })),
      configs,
      options: this.options,
      resolverRunner: new ResolverRunner({
        config: this.parcelConfig,
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
      this.request,
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
    parcelConfigKeyPath,
    isSource,
  }: {|
    filePath: FilePath,
    plugin: PackageName,
    parcelConfigPath: FilePath,
    parcelConfigKeyPath: string,
    isSource: boolean,
  |}): Promise<Config> {
    let configRequest = {
      filePath,
      env: this.request.env,
      plugin,
      isSource,
      meta: {
        parcelConfigPath,
        parcelConfigKeyPath,
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
  configKeyPath: string,
|};

async function runTransformer(
  pipeline: Pipeline,
  asset: UncommittedAsset,
  transformer: Transformer,
  transformerName: string,
  preloadedConfig: ?Config,
  configKeyPath: string,
  parcelConfig: ParcelConfig,
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

  // If an ast exists on the asset, but we cannot reuse it,
  // use the previous transform to generate code that we can re-parse.
  if (
    asset.ast &&
    asset.isASTDirty &&
    (!transformer.canReuseAST ||
      !transformer.canReuseAST({
        ast: asset.ast,
        options: pipeline.pluginOptions,
        logger,
      })) &&
    pipeline.generate
  ) {
    let output = await pipeline.generate(asset);
    asset.content = output.content;
    asset.mapBuffer = output.map?.toBuffer();
  }

  // Load config for the transformer.
  let config = preloadedConfig;

  // Parse if there is no AST available from a previous transform.
  if (!asset.ast && transformer.parse) {
    let ast = await transformer.parse({
      asset: new MutableAsset(asset),
      config,
      options: pipeline.pluginOptions,
      resolve,
      logger,
    });
    if (ast) {
      asset.setAST(ast);
      asset.isASTDirty = false;
    }
  }

  // Transform.
  let results = await normalizeAssets(
    // $FlowFixMe
    await transformer.transform({
      asset: new MutableAsset(asset),
      ast: asset.ast,
      config,
      options: pipeline.pluginOptions,
      resolve,
      logger,
    }),
  );

  // Create generate and postProcess functions that can be called later
  pipeline.generate = (input: UncommittedAsset): Promise<GenerateOutput> => {
    if (transformer.generate && input.ast) {
      let generated = transformer.generate({
        asset: new Asset(input),
        ast: input.ast,
        options: pipeline.pluginOptions,
        logger,
      });
      input.clearAST();
      return Promise.resolve(generated);
    }

    throw new Error(
      'Asset has an AST but no generate method is available on the transform',
    );
  };

  // For Flow
  let postProcess = transformer.postProcess;
  if (postProcess) {
    pipeline.postProcess = async (
      assets: Array<UncommittedAsset>,
    ): Promise<Array<UncommittedAsset> | null> => {
      let results = await postProcess.call(transformer, {
        assets: assets.map(asset => new MutableAsset(asset)),
        config,
        options: pipeline.pluginOptions,
        resolve,
        logger,
      });

      return Promise.all(
        results.map(result =>
          asset.createChildAsset(
            result,
            transformerName,
            parcelConfig.filePath,
            configKeyPath,
          ),
        ),
      );
    };
  }

  return results;
}

function normalizeAssets(
  results: Array<TransformerResult | MutableAsset>,
): Promise<Array<TransformerResult>> {
  return Promise.all(
    results.map<Promise<TransformerResult>>(async result => {
      if (!(result instanceof MutableAsset)) {
        return result;
      }

      let internalAsset = mutableAssetToUncommittedAsset(result);
      return {
        ast: internalAsset.ast,
        content: await internalAsset.content,
        // $FlowFixMe
        dependencies: [...internalAsset.value.dependencies.values()],
        env: internalAsset.value.env,
        filePath: result.filePath,
        isInline: result.isInline,
        isIsolated: result.isIsolated,
        map: await internalAsset.getMap(),
        meta: result.meta,
        pipeline: internalAsset.value.pipeline,
        type: result.type,
        uniqueKey: internalAsset.value.uniqueKey,
      };
    }),
  );
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

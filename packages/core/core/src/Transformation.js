// @flow strict-local
import nullthrows from 'nullthrows';
import type {
  MutableAsset as IMutableAsset,
  Blob,
  ConfigRequest,
  FilePath,
  GenerateOutput,
  Transformer,
  AssetRequest,
  TransformerResult,
  ParcelOptions,
  PackageName
} from '@parcel/types';

import path from 'path';
import {md5FromReadableStream, md5FromString, TapStream} from '@parcel/utils';
import Cache from '@parcel/cache';
import {createReadStream} from 'fs';

import Config from './Config';
import Dependency from './Dependency';
import ResolverRunner from './ResolverRunner';
import {report} from './ReporterRunner';
import {MutableAsset, assetToInternalAsset} from './public/Asset';
import InternalAsset from './Asset';
import type {NodeId} from './types';

type GenerateFunc = (input: IMutableAsset) => Promise<GenerateOutput>;

type PostProcessFunc = (
  Array<InternalAsset>
) => Promise<Array<InternalAsset> | null>;

const BUFFER_LIMIT = 5000000; // 5mb

export type TransformationOpts = {|
  request: AssetRequest,
  loadConfig: (ConfigRequest, NodeId) => Promise<Config>,
  parentNodeId: NodeId,
  options: ParcelOptions
|};

type ConfigMap = Map<PackageName, Config>;
export default class Transformation {
  request: AssetRequest;
  loadConfig: ConfigRequest => Promise<Config>;
  options: ParcelOptions;
  cache: Cache;

  constructor({
    request,
    loadConfig,
    parentNodeId,
    options
  }: TransformationOpts) {
    this.request = request;
    this.loadConfig = configRequest => loadConfig(configRequest, parentNodeId);
    this.options = options;
  }

  async run() {
    report({
      type: 'buildProgress',
      phase: 'transforming',
      request: this.request
    });

    this.cache = new Cache(this.options.cacheDir);

    let asset = await this.loadAsset();
    let pipeline = await this.loadPipeline(asset.filePath);
    return this.runPipeline(pipeline, asset);
  }

  async loadAsset() {
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

  async runPipeline(pipeline: Pipeline, initialAsset: InternalAsset) {
    let initialType = initialAsset.type;
    let initialCacheEntry = await this.readFromCache(
      [initialAsset],
      pipeline.configs
    );

    let assets = initialCacheEntry || (await pipeline.transform(initialAsset));
    if (!initialCacheEntry) {
      await this.writeToCache(assets, pipeline.configs);
    }

    let finalAssets: Array<InternalAsset> = [];
    for (let asset of assets) {
      if (asset.type !== initialType) {
        let nextFilePath =
          initialAsset.filePath.slice(
            0,
            -path.extname(initialAsset.filePath).length
          ) +
          '.' +
          asset.type;
        let nextPipeline = await this.loadPipeline(nextFilePath);
        let nextPipelineAssets = await this.runPipeline(nextPipeline, asset);
        await Promise.all(
          nextPipelineAssets.map(nextAsset => nextAsset.getCode())
        );
        finalAssets = finalAssets.concat(nextPipelineAssets);
      } else {
        finalAssets.push(asset);
      }
    }

    const postProcess = pipeline.postProcess;
    if (!postProcess) {
      return finalAssets;
    }

    let processedCacheEntry = await this.readFromCache(
      finalAssets,
      pipeline.configs
    );

    let processedFinalAssets =
      // For Flow
      processedCacheEntry || (await postProcess.call(pipeline, assets));
    if (!processedCacheEntry) {
      await this.writeToCache(processedFinalAssets, pipeline.configs);
    }

    return processedFinalAssets;
  }

  async readFromCache(assets: Array<InternalAsset>, configs: ConfigMap) {
    let cacheKey = await this.getCacheKey(assets, configs);
    let cachedAssets = this.cache.get(cacheKey);
    if (cachedAssets) {
      await Promise.all(assets.map(asset => asset.getCode()));
    }
    return cachedAssets;
  }

  async writeToCache(assets: Array<InternalAsset>, configs: ConfigMap) {
    let cacheKey = await this.getCacheKey(assets, configs);
    await Promise.all(assets.map(asset => asset.commit()));
    this.cache.set(cacheKey, assets);
  }

  async getCacheKey(assets: Array<InternalAsset>, configs: ConfigMap) {
    let assetIdentities = assets.map(({filePath, type, hash}) => ({
      filePath,
      hash,
      type
    }));

    // TODO: sort
    let configHashes = [...configs].map(([, config]) => config.resultHash);

    // TODO: these options may not impact all transformations, let transformers decide if they care or not
    let {minify, hot, scopeHoist} = this.options;
    let impactfulOptions = {minify, hot, scopeHoist};

    return md5FromString(
      JSON.stringify({
        assetIdentities,
        configHashes,
        env: this.request.env,
        impactfulOptions
      })
    );
  }

  async loadPipeline(filePath: FilePath) {
    let configRequest = {
      filePath,
      meta: {
        actionType: 'transformation'
      }
    };
    let configs = new Map();

    let config = await this.loadConfig(configRequest);
    let parcelConfig = nullthrows(config.result);

    configs.set('parcel', config);

    for (let [moduleName] of config.devDeps) {
      let plugin = await parcelConfig.loadPlugin(moduleName);
      // TODO: implement loadPlugin in existing plugins that require config
      if (plugin.loadConfig) {
        let thirdPartyConfig = await this.loadTransformerConfig(
          filePath,
          moduleName,
          parcelConfig.resolvedPath
        );
        configs.set(moduleName, thirdPartyConfig);
      }
    }

    let pipeline = new Pipeline(
      await parcelConfig.getTransformers(filePath),
      configs,
      this.options
    );

    return pipeline;
  }

  async loadTransformerConfig(
    filePath: FilePath,
    plugin: PackageName,
    parcelConfigPath: FilePath
  ) {
    let configRequest = {
      filePath,
      plugin,
      meta: {
        parcelConfigPath
      }
    };
    return this.loadConfig(configRequest);
  }
}

class Pipeline {
  transformers: Array<Transformer>;
  configs: ConfigMap;
  options: ParcelOptions;
  resolverRunner: ResolverRunner;
  generate: GenerateFunc;
  postProcess: ?PostProcessFunc;

  constructor(
    transformers: Array<Transformer>,
    configs: ConfigMap,
    options: ParcelOptions
  ) {
    this.transformers = transformers;
    this.configs = configs;
    this.options = options;
    let parcelConfig = nullthrows(this.configs.get('parcel'));
    parcelConfig = nullthrows(parcelConfig.result);
    this.resolverRunner = new ResolverRunner({
      config: parcelConfig,
      options
    });
  }

  async transform(initialAsset: InternalAsset) {
    let inputAssets = [initialAsset];
    let resultingAssets;
    let finalAssets = [];
    for (let transformer of this.transformers) {
      resultingAssets = [];
      for (let asset of inputAssets) {
        if (asset.type !== initialAsset.type) {
          finalAssets.push(asset);
        } else {
          let transformerResults = await this.runTransformer(
            asset,
            transformer
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

  async runTransformer(asset: InternalAsset, transformer: Transformer) {
    const resolve = async (from: FilePath, to: string): Promise<FilePath> => {
      return (await this.resolverRunner.resolve(
        new Dependency({
          env: asset.env,
          moduleSpecifier: to,
          sourcePath: from
        })
      )).filePath;
    };

    // Load config for the transformer.
    let config = null;
    if (transformer.getConfig) {
      config = await transformer.getConfig({
        asset: new MutableAsset(asset),
        options: this.options,
        resolve
      });
    }

    // If an ast exists on the asset, but we cannot reuse it,
    // use the previous transform to generate code that we can re-parse.
    if (
      asset.ast &&
      (!transformer.canReuseAST ||
        !transformer.canReuseAST({ast: asset.ast, options: this.options})) &&
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
        options: this.options,
        resolve
      });
    }

    // Transform.
    let results = await normalizeAssets(
      // $FlowFixMe
      await transformer.transform({
        asset: new MutableAsset(asset),
        config,
        options: this.options,
        resolve
      })
    );

    // Create generate and postProcess functions that can be called later
    this.generate = async (input: IMutableAsset): Promise<GenerateOutput> => {
      if (transformer.generate) {
        return transformer.generate({
          asset: input,
          config,
          options: this.options,
          resolve
        });
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
          options: this.options,
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
    asset.content = result.code;
    asset.map = result.map;
  }
  return asset;
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
      dependencies: result.getDependencies(),
      connectedFiles: result.getConnectedFiles(),
      // $FlowFixMe
      env: result.env,
      isIsolated: result.isIsolated,
      meta: result.meta
    };
  });
}

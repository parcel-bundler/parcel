// @flow

import type {
  MutableAsset as IMutableAsset,
  Blob,
  File,
  GenerateOutput,
  Transformer,
  TransformerRequest,
  TransformerResult,
  ParcelOptions
} from '@parcel/types';
import type {CacheEntry} from './types';

import path from 'path';
import clone from 'clone';
import {
  md5FromFilePath,
  md5FromReadableStream,
  md5FromString
} from '@parcel/utils';
import Cache from '@parcel/cache';
import {createReadStream} from 'fs';
import {TapStream, unique} from '@parcel/utils';
import Config from './Config';
import {report} from './ReporterRunner';
import nullthrows from 'nullthrows';
import {Asset, MutableAsset, assetToInternalAsset} from './public/Asset';
import InternalAsset from './Asset';

type Opts = {|
  config: Config,
  options: ParcelOptions
|};

type GenerateFunc = (input: IMutableAsset) => Promise<GenerateOutput>;

const BUFFER_LIMIT = 5000000; // 5mb

export default class TransformerRunner {
  options: ParcelOptions;
  config: Config;

  constructor(opts: Opts) {
    this.options = opts.options;
    this.config = opts.config;
  }

  async transform(req: TransformerRequest): Promise<CacheEntry> {
    report({
      type: 'buildProgress',
      phase: 'transforming',
      request: req
    });

    // If a cache entry matches, no need to transform.
    let cacheEntry;
    if (this.options.cache !== false && req.code == null) {
      cacheEntry = await Cache.get(reqCacheKey(req));
    }

    let {content, size, hash} = await summarizeRequest(req);
    if (
      cacheEntry &&
      cacheEntry.hash === hash &&
      (await checkCachedAssets(cacheEntry.assets))
    ) {
      return cacheEntry;
    }

    let input = new InternalAsset({
      filePath: req.filePath,
      type: path.extname(req.filePath).slice(1),
      ast: null,
      content,
      hash,
      env: req.env,
      stats: {
        time: 0,
        size
      }
    });

    let pipeline = await this.config.getTransformers(req.filePath);
    let {assets, initialAssets} = await this.runPipeline(
      input,
      pipeline,
      cacheEntry
    );

    // If the transformer request passed code rather than a filename,
    // use a hash as the id to ensure it is unique.
    if (req.code) {
      for (let asset of assets) {
        asset.id = md5FromString(
          nullthrows(asset.hash) + JSON.stringify(asset.env)
        );
      }
    }

    cacheEntry = {
      filePath: req.filePath,
      env: req.env,
      hash,
      assets,
      initialAssets
    };

    await Promise.all(
      unique([...assets, ...(initialAssets || [])]).map(asset => asset.commit())
    );
    await Cache.set(reqCacheKey(req), cacheEntry);
    return cacheEntry;
  }

  async runPipeline(
    input: InternalAsset,
    pipeline: Array<Transformer>,
    cacheEntry: ?CacheEntry,
    previousGenerate: ?GenerateFunc
  ): Promise<{|
    assets: Array<InternalAsset>,
    initialAssets: ?Array<InternalAsset>
  |}> {
    // Run the first transformer in the pipeline.
    let {results, generate, postProcess} = await this.runTransform(
      input,
      pipeline[0],
      previousGenerate
    );

    let assets: Array<InternalAsset> = [];
    for (let result of results) {
      let asset = input.createChildAsset(result);

      // Check if any of the cached assets match the result.
      if (cacheEntry) {
        let cachedAssets: Array<InternalAsset> = (
          cacheEntry.initialAssets || cacheEntry.assets
        ).filter(child => child.hash && child.hash === asset.hash);

        if (
          cachedAssets.length > 0 &&
          (await checkCachedAssets(cachedAssets))
        ) {
          assets = assets.concat(cachedAssets);
          continue;
        }
      }

      // If the generated asset has the same type as the input...
      // TODO: this is incorrect since multiple file types could map to the same pipeline. need to compare the pipelines.
      if (result.type === input.type) {
        // If we have reached the last transform in the pipeline, then we are done.
        if (pipeline.length === 1) {
          assets.push(await finalize(asset, generate));
        } else {
          // Recursively run the remaining transforms in the pipeline.
          let nextPipelineResult = await this.runPipeline(
            asset,
            pipeline.slice(1),
            null,
            generate
          );

          assets = assets.concat(nextPipelineResult.assets);
        }
      } else {
        // Jump to a different pipeline for the generated asset.
        let nextFilePath =
          input.filePath.slice(0, -path.extname(input.filePath).length) +
          '.' +
          result.type;
        let nextPipelineResult = await this.runPipeline(
          asset,
          await this.config.getTransformers(nextFilePath),
          null,
          generate
        );

        assets = assets.concat(nextPipelineResult.assets);
      }
    }

    // If the transformer has a postProcess function, execute that with the result of the pipeline.
    let finalAssets = await postProcess(clone(assets));
    return {
      assets: finalAssets || assets,
      initialAssets: finalAssets ? assets : null
    };
  }

  async runTransform(
    input: InternalAsset,
    transformer: Transformer,
    previousGenerate: ?GenerateFunc
  ) {
    // Load config for the transformer.
    let config = null;
    if (transformer.getConfig) {
      config = await transformer.getConfig(new Asset(input), this.options);
    }

    // If an ast exists on the input, but we cannot reuse it,
    // use the previous transform to generate code that we can re-parse.
    if (
      input.ast &&
      (!transformer.canReuseAST ||
        !transformer.canReuseAST(input.ast, this.options)) &&
      previousGenerate
    ) {
      let output = await previousGenerate(new MutableAsset(input));
      input.content = output.code;
      input.ast = null;
    }

    // Parse if there is no AST available from a previous transform.
    if (!input.ast && transformer.parse) {
      input.ast = await transformer.parse(
        new Asset(input),
        config,
        this.options
      );
    }

    // Transform.
    let results = normalizeAssets(
      // $FlowFixMe
      await transformer.transform(new MutableAsset(input), config, this.options)
    );

    // Create a generate function that can be called later to lazily generate
    let generate = async (input: IMutableAsset): Promise<GenerateOutput> => {
      if (transformer.generate) {
        return transformer.generate(input, config, this.options);
      }

      throw new Error(
        'Asset has an AST but no generate method is available on the transform'
      );
    };

    // Create a postProcess function that can be called later
    let postProcess = async (
      assets: Array<InternalAsset>
    ): Promise<Array<InternalAsset> | null> => {
      let {postProcess} = transformer;
      if (postProcess) {
        let results = await postProcess(
          assets.map(asset => new MutableAsset(asset)),
          config,
          this.options
        );

        return Promise.all(
          results.map(result => input.createChildAsset(result))
        );
      }

      return null;
    };

    return {results, generate, postProcess};
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

async function checkCachedAssets(
  assets: Array<InternalAsset>
): Promise<boolean> {
  let results = await Promise.all(
    assets.map(asset => checkConnectedFiles(asset.getConnectedFiles()))
  );

  return results.every(Boolean);
}

async function checkConnectedFiles(files: Array<File>): Promise<boolean> {
  let hashes = await Promise.all(
    files.map(file => md5FromFilePath(file.filePath))
  );

  return files.every((file, index) => file.hash === hashes[index]);
}

function reqCacheKey(req: TransformerRequest): string {
  return md5FromString(req.filePath + JSON.stringify(req.env));
}

async function summarizeRequest(
  req: TransformerRequest
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
    return result instanceof MutableAsset
      ? {
          type: result.type,
          content: assetToInternalAsset(result).content,
          ast: result.ast,
          // $FlowFixMe
          dependencies: result.getDependencies(),
          connectedFiles: result.getConnectedFiles(),
          // $FlowFixMe
          env: result.env,
          isIsolated: result.isIsolated,
          meta: result.meta
        }
      : result;
  });
}

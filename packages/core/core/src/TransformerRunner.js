// @flow
import type {
  Asset as IAsset,
  AssetOutput,
  CacheEntry,
  File,
  Transformer,
  TransformerRequest,
  ParcelOptions
} from '@parcel/types';
import Asset from './Asset';
import path from 'path';
import clone from 'clone';
import md5 from '@parcel/utils/lib/md5';
import Cache from '@parcel/cache';
import fs from '@parcel/fs';
import Config from './Config';
import {report} from './ReporterRunner';

type Opts = {
  config: Config,
  options: ParcelOptions
};

type GenerateFunc = ?(input: Asset) => Promise<AssetOutput>;

class TransformerRunner {
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

    let code = req.code || (await fs.readFile(req.filePath, 'utf8'));
    let hash = md5(code);

    // If a cache entry matches, no need to transform.
    let cacheEntry;
    if (this.options.cache !== false && req.code == null) {
      cacheEntry = await Cache.read(req.filePath, req.env);
    }

    if (
      cacheEntry &&
      cacheEntry.hash === hash &&
      (await checkCachedAssets(cacheEntry.assets))
    ) {
      return cacheEntry;
    }

    let input = new Asset({
      id: hash,
      filePath: req.filePath,
      type: path.extname(req.filePath).slice(1),
      ast: null,
      code,
      env: req.env,
      sideEffects: req.sideEffects
    });

    let pipeline = await this.config.getTransformers(req.filePath);
    let {assets, initialAssets} = await this.runPipeline(
      input,
      pipeline,
      cacheEntry
    );

    // If the transformer request passed code rather than a filename,
    // use a hash as the id to ensure it is unique.
    // if (req.code) {
    //   for (let asset of assets) {
    //     asset.id = asset.outputHash;
    //   }
    // }

    cacheEntry = {
      filePath: req.filePath,
      env: req.env,
      hash,
      assets,
      initialAssets
    };

    await Cache.write(cacheEntry);
    return cacheEntry;
  }

  async runPipeline(
    input: Asset,
    pipeline: Array<Transformer>,
    cacheEntry: ?CacheEntry,
    previousGenerate: ?GenerateFunc
  ) {
    // Run the first transformer in the pipeline.
    let {results, generate, postProcess} = await this.runTransform(
      input,
      pipeline[0],
      previousGenerate
    );

    let assets: Array<IAsset> = [];
    for (let result of results) {
      let asset = input.createChildAsset(result);

      // Check if any of the cached assets match the result.
      if (cacheEntry) {
        let cachedAssets = (
          cacheEntry.initialAssets || cacheEntry.assets
        ).filter(child => child.hash === asset.hash);

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
    input: Asset,
    transformer: Transformer,
    previousGenerate: GenerateFunc
  ) {
    // Load config for the transformer.
    let config = null;
    if (transformer.getConfig) {
      config = await transformer.getConfig(input, this.options);
    }

    // If an ast exists on the input, but we cannot reuse it,
    // use the previous transform to generate code that we can re-parse.
    if (
      input.ast &&
      (!transformer.canReuseAST ||
        !transformer.canReuseAST(input.ast, this.options)) &&
      previousGenerate
    ) {
      let output = await previousGenerate(input);
      input.output = output;
      input.code = output.code;
      input.ast = null;
    }

    // Parse if there is no AST available from a previous transform.
    if (!input.ast && transformer.parse) {
      input.ast = await transformer.parse(input, config, this.options);
    }

    // Transform.
    let results = await transformer.transform(input, config, this.options);

    // Create a generate function that can be called later to lazily generate
    let generate = async (input: Asset): Promise<AssetOutput> => {
      if (transformer.generate) {
        return await transformer.generate(input, config, this.options);
      }

      throw new Error(
        'Asset has an AST but no generate method is available on the transform'
      );
    };

    // Create a postProcess function that can be called later
    let postProcess = async (
      assets: Array<IAsset>
    ): Promise<Array<Asset> | null> => {
      if (transformer.postProcess) {
        let results = await transformer.postProcess(
          assets,
          config,
          this.options
        );

        return Promise.all(
          results.map(result => input.createChildAsset(result))
        );
      }

      return null;
    };

    // $FlowFixMe
    return {results, generate, postProcess};
  }
}

async function finalize(asset: Asset, generate: GenerateFunc): Promise<Asset> {
  if (asset.ast && generate) {
    asset.output = await generate(asset);
  }

  asset.ast = null;
  asset.code = '';
  asset.outputHash = md5(asset.output.code);

  return asset;
}

async function checkCachedAssets(assets: Array<IAsset>): Promise<boolean> {
  let results = await Promise.all(
    assets.map(asset => checkConnectedFiles(asset.connectedFiles))
  );

  return results.every(Boolean);
}

async function checkConnectedFiles(files: Array<File>): Promise<boolean> {
  let hashes = await Promise.all(files.map(file => md5.file(file.filePath)));

  return files.every((file, index) => file.hash === hashes[index]);
}

module.exports = TransformerRunner;

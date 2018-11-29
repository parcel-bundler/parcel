// @flow
import type {
  Asset as IAsset,
  AssetOutput,
  CacheEntry,
  File,
  Transformer,
  TransformerRequest,
  CLIOptions
} from '@parcel/types';
import Asset from './Asset';
import path from 'path';
import clone from 'clone';
import md5 from '@parcel/utils/md5';
import Cache from '@parcel/cache';
import fs from '@parcel/fs';
import Config from './Config';

type Opts = {
  config: Config,
  cliOpts: CLIOptions,
  cache?: Cache
};

type GenerateFunc = ?(input: Asset) => Promise<AssetOutput>;

class TransformerRunner {
  cliOpts: CLIOptions;
  config: Config;
  cache: Cache;

  constructor(opts: Opts) {
    this.cliOpts = opts.cliOpts;
    this.config = opts.config;
    this.cache = opts.cache || new Cache(opts.cliOpts);
  }

  async transform(req: TransformerRequest): Promise<CacheEntry> {
    let code = await fs.readFile(req.filePath, 'utf8');
    let hash = md5(code);

    // If a cache entry matches, no need to transform.
    let cacheEntry = await this.cache.read(req.filePath, req.env);
    if (
      cacheEntry &&
      cacheEntry.hash === hash &&
      (await checkCacheEntry(cacheEntry))
    ) {
      return cacheEntry;
    }

    let input = new Asset({
      filePath: req.filePath,
      type: path.extname(req.filePath).slice(1),
      ast: null,
      code,
      env: req.env
    });

    let pipeline = await this.config.getTransformers(req.filePath);
    let {assets, initialAssets, connectedFiles} = await this.runPipeline(
      input,
      pipeline,
      cacheEntry
    );

    cacheEntry = {
      filePath: req.filePath,
      env: req.env,
      hash,
      assets,
      initialAssets,
      connectedFiles
    };

    await this.cache.write(cacheEntry);
    return cacheEntry;
  }

  async runPipeline(
    input: Asset,
    pipeline: Array<Transformer>,
    cacheEntry: ?CacheEntry,
    previousGenerate: ?GenerateFunc
  ) {
    // Run the first transformer in the pipeline.
    let {
      results,
      connectedFiles,
      generate,
      postProcess
    } = await this.runTransform(input, pipeline[0], previousGenerate);

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
          let nextInput = input.createChildAsset(result);
          let cacheEntry = await this.runPipeline(
            nextInput,
            pipeline.slice(1),
            null,
            generate
          );

          assets = assets.concat(cacheEntry.assets);
          connectedFiles = connectedFiles.concat(cacheEntry.connectedFiles);
        }
      } else {
        // Jump to a different pipeline for the generated asset.
        let nextInput = input.createChildAsset(result);
        let nextFilePath =
          input.filePath.slice(0, -path.extname(input.filePath).length) +
          '.' +
          result.type;
        let cacheEntry = await this.runPipeline(
          nextInput,
          await this.config.getTransformers(nextFilePath),
          null,
          generate
        );

        assets = assets.concat(cacheEntry.assets);
        connectedFiles = connectedFiles.concat(cacheEntry.connectedFiles);
      }
    }

    // If the transformer has a postProcess function, execute that with the result of the pipeline.
    let finalAssets = await postProcess(clone(assets));

    return {
      assets: finalAssets || assets,
      initialAssets: finalAssets ? assets : null,
      connectedFiles
    };
  }

  async runTransform(
    input: Asset,
    transformer: Transformer,
    previousGenerate: GenerateFunc
  ) {
    // Load config for the transformer.
    let config = null;
    let connectedFiles: Array<File> = [];
    if (transformer.getConfig) {
      let result = await transformer.getConfig(input.filePath, this.cliOpts);
      if (result) {
        config = result.config;
        connectedFiles = result.files;
      }
    }

    // If an ast exists on the input, but we cannot reuse it,
    // use the previous transform to generate code that we can re-parse.
    if (
      input.ast &&
      (!transformer.canReuseAST ||
        !transformer.canReuseAST(input.ast, this.cliOpts)) &&
      previousGenerate
    ) {
      let output = await previousGenerate(input);
      input.code = output.code;
      input.ast = null;
    }

    // Parse if there is no AST available from a previous transform.
    if (!input.ast && transformer.parse) {
      input.ast = await transformer.parse(input, config, this.cliOpts);
    }

    // Transform.
    let results = await transformer.transform(input, config, this.cliOpts);

    // Create a generate function that can be called later to lazily generate
    let generate = async (input: Asset): Promise<AssetOutput> => {
      if (transformer.generate) {
        return await transformer.generate(input, config, this.cliOpts);
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
          this.cliOpts
        );

        return Promise.all(
          results.map(result => input.createChildAsset(result))
        );
      }

      return null;
    };

    return {results, connectedFiles, generate, postProcess};
  }
}

async function finalize(asset: Asset, generate: GenerateFunc): Promise<Asset> {
  if (asset.ast && generate) {
    asset.output = await generate(asset);
    asset.ast = null;
  }

  return asset;
}

async function checkCacheEntry(cacheEntry: CacheEntry): Promise<boolean> {
  let results = await Promise.all([
    checkConnectedFiles(cacheEntry.connectedFiles),
    checkCachedAssets(cacheEntry.assets)
  ]);

  return results.every(Boolean);
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

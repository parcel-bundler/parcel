// @flow
import type {
  Asset,
  AssetOutput,
  CacheEntry,
  Dependency,
  Environment,
  File,
  JSONObject,
  ParcelConfig,
  Transformer,
  TransformerInput,
  TransformerResult
} from '@parcel/types';
import micromatch from 'micromatch';
import localRequire from '@parcel/utils/localRequire';
import path from 'path';
// import Asset from './Asset';
import clone from 'clone';
import md5 from '@parcel/utils/md5';
import Cache from '@parcel/cache';
import fs from '@parcel/fs';

type Opts = {
  parcelConfig: ParcelConfig,
  cliOpts: JSONObject
};

type GenerateFunc = ?(input: TransformerInput) => Promise<AssetOutput>;
type TransformContext = {
  hash?: string,
  dependencies: Array<Dependency>,
  generate?: GenerateFunc
};

class TransformerRunner {
  cliOpts: JSONObject;
  parcelConfig: ParcelConfig;
  cache: Cache;

  constructor({parcelConfig, cliOpts}: Opts) {
    this.cliOpts = cliOpts;
    this.parcelConfig = parcelConfig;
    this.cache = new Cache(cliOpts);
  }

  async transform(file: File, env: Environment): Promise<CacheEntry> {
    let code = await fs.readFile(file.filePath, 'utf8');
    let hash = md5(code);

    // If a cache entry matches, no need to transform.
    let cacheEntry = await this.cache.read(file.filePath);
    if (cacheEntry && cacheEntry.hash === hash) {
      return cacheEntry;
    }

    let input: TransformerInput = {
      filePath: file.filePath,
      ast: null,
      code,
      env
    };

    let context = {
      dependencies: []
    };

    let pipeline = await this.resolvePipeline(file.filePath);
    let {assets, postProcessedAssets, dependencies} = await this.runPipeline(
      input,
      pipeline,
      cacheEntry,
      context
    );
    cacheEntry = {
      filePath: file.filePath,
      hash,
      assets,
      postProcessedAssets,
      dependencies
    };

    console.log(cacheEntry);
    await this.cache.writeBlobs(cacheEntry);

    await this.cache.write(file.filePath, cacheEntry);
    return cacheEntry;
  }

  async resolvePipeline(filePath: string): Promise<Array<Transformer>> {
    for (let pattern in this.parcelConfig.transforms) {
      if (
        micromatch.isMatch(filePath, pattern) ||
        micromatch.isMatch(path.basename(filePath), pattern)
      ) {
        return Promise.all(
          this.parcelConfig.transforms[pattern].map(transform =>
            localRequire(transform, filePath)
          )
        );
      }
    }

    return [];
  }

  async runPipeline(
    input: TransformerInput,
    pipeline: Array<Transformer>,
    cacheEntry: ?CacheEntry,
    context: TransformContext
  ) {
    let inputType = path.extname(input.filePath).slice(1);

    // Run the first transformer in the pipeline.
    let {
      results,
      dependencies,
      generate,
      postProcess
    } = await this.runTransform(input, pipeline[0], context.generate);

    let assets: Array<Asset> = [];
    for (let result of results) {
      let asset;
      let ctx: TransformContext = {
        generate,
        dependencies: context.dependencies.concat(result.dependencies || [])
      };

      // If this is the first transformer, create a hash for the asset.
      if (!context.hash) {
        asset = await transformerResultToAsset(input, result, ctx);
        ctx.hash = asset.hash;
      }

      // Check if any of the cached assets match the result.
      if (cacheEntry) {
        let cachedAssets = cacheEntry.assets.filter(
          child => child.hash === ctx.hash
        );

        if (cachedAssets.length > 0) {
          assets = assets.concat(cachedAssets);
          continue;
        }
      }

      // If the generated asset has the same type as the input...
      if (result.type === inputType) {
        // If we have reached the last transform in the pipeline, then we are done.
        if (pipeline.length === 1) {
          assets.push(
            asset || (await transformerResultToAsset(input, result, ctx))
          );
        } else {
          // Recursively run the remaining transforms in the pipeline.
          let nextInput = transformerResultToInput(input, result);
          let cacheEntry = await this.runPipeline(
            nextInput,
            pipeline.slice(1),
            null,
            ctx
          );

          assets = assets.concat(
            cacheEntry.postProcessedAssets || cacheEntry.assets
          );

          dependencies = dependencies.concat(cacheEntry.dependencies);
        }
      } else {
        // Jump to a different pipeline for the generated asset.
        let nextInput = transformerResultToInput(input, result);
        let nextFilePath =
          input.filePath.slice(0, -path.extname(input.filePath).length) +
          '.' +
          result.type;
        let cacheEntry = await this.runPipeline(
          nextInput,
          await this.resolvePipeline(nextFilePath),
          null,
          ctx
        );

        assets = assets.concat(
          cacheEntry.postProcessedAssets || cacheEntry.assets
        );

        dependencies = dependencies.concat(cacheEntry.dependencies);
      }
    }

    // If the transformer has a postProcess function, execute that with the result of the pipeline.
    let postProcessedAssets = await postProcess(clone(assets), context);

    return {
      assets,
      postProcessedAssets,
      dependencies
    };
  }

  async runTransform(
    input: TransformerInput,
    transformer: Transformer,
    previousGenerate: GenerateFunc
  ) {
    // Load config for the transformer.
    let config = null;
    let dependencies: Array<Dependency> = [];
    if (transformer.getConfig) {
      let result = await transformer.getConfig(input.filePath, this.cliOpts);
      if (result) {
        config = result.config;
        dependencies = result.dependencies;
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
    let generate = async (input: TransformerInput): Promise<AssetOutput> => {
      return await transformer.generate(input, config, this.cliOpts);
    };

    // Create a postProcess function that can be called later
    let postProcess = async (
      assets: Array<Asset>,
      context: TransformContext
    ): Promise<Array<Asset> | null> => {
      if (transformer.postProcess) {
        let results = await transformer.postProcess(
          assets,
          config,
          this.cliOpts
        );

        return Promise.all(
          results.map(result =>
            transformerResultToAsset(input, result, context)
          )
        );
      }

      return null;
    };

    return {results, dependencies, generate, postProcess};
  }
}

async function transformerResultToAsset(
  input: TransformerInput,
  result: TransformerResult,
  context: TransformContext
): Promise<Asset> {
  let output: AssetOutput = result.output || {code: result.code || ''};
  if (result.code) {
    output = clone(output);
    output.code = result.code || '';
  }

  if (result.ast && context.generate) {
    output = await context.generate(transformerResultToInput(input, result));
  }

  let env = mergeEnvironment(input.env, result.env);
  return {
    id: md5(input.filePath + result.type + JSON.stringify(env)),
    hash: context.hash || md5(output.code),
    filePath: input.filePath,
    type: result.type,
    dependencies: context.dependencies.concat(result.dependencies || []),
    output,
    env
  };
}

function transformerResultToInput(
  input: TransformerInput,
  result: TransformerResult
): TransformerInput {
  return {
    filePath: input.filePath,
    code: result.code || (result.output && result.output.code) || '',
    ast: result.ast,
    env: mergeEnvironment(input.env, result.env)
  };
}

function mergeEnvironment(a: Environment, b: ?Environment): Environment {
  return Object.assign({}, a, b);
}

module.exports = TransformerRunner;

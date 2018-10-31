// @flow
import type {
  Asset,
  AssetOutput,
  CacheEntry,
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

class TransformerRunner {
  cliOpts: JSONObject;
  parcelConfig: ParcelConfig;
  cache: Cache;

  constructor({parcelConfig, cliOpts}: Opts) {
    this.cliOpts = cliOpts;
    this.parcelConfig = parcelConfig;
    this.cache = new Cache(cliOpts);
  }

  async transform(file: File, env: Environment) {
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

    let pipeline = await this.resolvePipeline(file.filePath);
    cacheEntry = await this.runPipeline(input, pipeline, cacheEntry, hash);

    if (cacheEntry.postProcessedAssets === cacheEntry.assets) {
      delete cacheEntry.postProcessedAssets;
    }

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
    hash: string,
    previousGenerate: GenerateFunc
  ): Promise<CacheEntry> {
    let inputType = path.extname(input.filePath).slice(1);

    // Run the first transformer in the pipeline.
    let {results, generate, postProcess} = await this.runTransform(
      input,
      pipeline[0],
      previousGenerate
    );

    let assets: Array<Asset> = [];
    for (let result of results) {
      let asset;

      // If this is the first transformer, create a hash for the asset.
      if (!previousGenerate) {
        asset = await transformerResultToAsset(input, result, generate);
        hash = asset.hash;
      }

      // Check if any of the cached assets match the result.
      if (cacheEntry) {
        let cachedAssets = cacheEntry.assets.filter(
          child => child.hash === hash
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
            asset ||
              (await transformerResultToAsset(input, result, generate, hash))
          );
        } else {
          // Recursively run the remaining transforms in the pipeline.
          let nextInput = transformerResultToInput(input, result);
          let cacheEntry = await this.runPipeline(
            nextInput,
            pipeline.slice(1),
            null,
            hash,
            generate
          );

          assets = assets.concat(
            cacheEntry.postProcessedAssets || cacheEntry.assets
          );
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
          hash,
          generate
        );

        assets = assets.concat(
          cacheEntry.postProcessedAssets || cacheEntry.assets
        );
      }
    }

    // If the transformer has a postProcess function, execute that with the result of the pipeline.
    let postProcessedAssets = await postProcess(assets);

    return {
      filePath: input.filePath,
      hash,
      assets,
      postProcessedAssets
    };
  }

  async runTransform(
    input: TransformerInput,
    transformer: Transformer,
    previousGenerate: GenerateFunc
  ) {
    // Load config for the transformer.
    let config = null;
    if (transformer.getConfig) {
      let result = await transformer.getConfig(input.filePath, this.cliOpts);
      if (result) {
        config = result.config;
        // TODO: do something with dependencies
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
    if (!input.ast) {
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
      assets: Array<Asset>
    ): Promise<Array<Asset> | null> => {
      if (transformer.postProcess) {
        let results = await transformer.postProcess(
          assets,
          config,
          this.cliOpts
        );

        return Promise.all(
          results.map(result => transformerResultToAsset(input, result))
        );
      }

      return null;
    };

    // $FlowFixMe - I don't understand why this is broken.
    return {results, generate, postProcess};
  }
}

let ID = 0;
async function transformerResultToAsset(
  input: TransformerInput,
  result: TransformerResult,
  generate: GenerateFunc,
  hash: ?string
): Promise<Asset> {
  let output: AssetOutput = result.output || {code: result.code || ''};
  if (result.code) {
    output = clone(output);
    output.code = result.code || '';
  }

  if (result.ast && generate) {
    output = await generate(transformerResultToInput(input, result));
  }

  return {
    id: '' + ID++, // TODO: make something deterministic
    hash: hash || md5(output.code),
    filePath: input.filePath,
    type: result.type,
    output,
    dependencies: result.dependencies || [], // TODO: merge
    env: mergeEnvironment(input.env, result.env)
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

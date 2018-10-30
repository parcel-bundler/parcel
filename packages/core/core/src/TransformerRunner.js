// @flow
import type {
  Dependency,
  Asset,
  File,
  Transformer,
  TransformerAsset,
  CacheEntry,
  Config,
  JSONObject,
  ParcelConfig
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

class TransformerRunner {
  cliOpts: JSONObject;
  parcelConfig: ParcelConfig;
  cache: Cache;

  constructor({parcelConfig, cliOpts}: Opts) {
    this.cliOpts = cliOpts;
    this.parcelConfig = parcelConfig;
    this.cache = new Cache(cliOpts);
  }

  async transform(file: File) {
    let code = await fs.readFile(file.filePath, 'utf8');
    let hash = md5(code);

    let cacheEntry = await this.cache.read(file.filePath);
    if (cacheEntry && cacheEntry.hash === hash) {
      return cacheEntry;
    }

    let asset: TransformerAsset = {
      filePath: file.filePath,
      code,
      ast: null,
      dependencies: [],
      output: {}
    };

    let pipeline = await this.resolvePipeline(asset);

    let {children, results} = await this.runPipeline(
      asset,
      pipeline,
      cacheEntry
    );
    cacheEntry = {
      hash,
      children,
      results: results === children ? null : results
    };

    await this.cache.writeBlobs(cacheEntry);

    await this.cache.write(asset.filePath, cacheEntry);
    return cacheEntry;
  }

  async resolvePipeline(asset): Array<Transformer> {
    for (let pattern in this.parcelConfig.transforms) {
      if (
        micromatch.isMatch(asset.filePath, pattern) ||
        micromatch.isMatch(path.basename(asset.filePath), pattern)
      ) {
        return Promise.all(
          this.parcelConfig.transforms[pattern].map(
            (transform: string): Promise<Transformer> =>
              localRequire(transform, asset.filePath)
          )
        );
      }
    }
  }

  async runPipeline(
    asset: TransformerAsset,
    pipeline: Array<Transformer>,
    cacheEntry: CacheEntry,
    previousTransformer: Transformer = null,
    previousConfig: Config = null
  ) {
    // Run the first transformer in the pipeline.
    let transformer = pipeline[0];
    let config = null;
    if (transformer.getConfig) {
      let result = await transformer.getConfig(asset, this.cliOpts);
      if (result) {
        config = result.config;
        // TODO: do something with deps
      }
    }

    let assets = await this.runTransform(
      asset,
      transformer,
      config,
      previousTransformer,
      previousConfig
    );

    let children: Asset = [];
    for (let subAsset of assets) {
      subAsset =
        subAsset instanceof Asset ? subAsset : new Asset(subAsset, asset);

      if (!previousTransformer) {
        if (subAsset.ast) {
          this.generate(transformer, subAsset, config);
        }

        subAsset.hash = md5(subAsset.code);

        if (cacheEntry) {
          let cachedChildren = cacheEntry.assets.filter(
            child => child.hash === subAsset.hash
          );
          if (cachedChildren.length > 0) {
            children = children.concat(cachedChildren);
            continue;
          }
        }
      }

      // If the generated asset has the same type as the input...
      if (subAsset.type === asset.type) {
        // If we have reached the last transform in the pipeline, then we are done.
        if (pipeline.length === 1) {
          if (subAsset.ast) {
            await this.generate(transformer, subAsset, config);
          }

          children.push(subAsset);

          // Otherwise, recursively run the remaining transforms in the pipeline.
        } else {
          children = children.concat(
            (await this.runPipeline(
              subAsset,
              pipeline.slice(1),
              cacheEntry,
              transformer,
              config
            )).results
          );
        }

        // Otherwise, jump to a different pipeline for the generated asset.
      } else {
        children = children.concat(
          (await this.runPipeline(
            subAsset,
            await this.resolvePipeline(subAsset),
            cacheEntry,
            transformer,
            config
          )).results
        );
      }
    }

    // If the transformer has a postProcess function, execute that with the result of the pipeline.
    let results = children;
    if (transformer.postProcess) {
      children = previousTransformer ? children : clone(children);
      results = await transformer.postProcess(children, config, this.cliOpts);
    }

    return {children, results};
  }

  async runTransform(
    asset: TransformerAsset,
    transformer: Transformer,
    config: Config,
    previousTransformer: Transformer,
    previousConfig: Config
  ) {
    if (
      asset.ast &&
      (!transformer.canReuseAST ||
        !transformer.canReuseAST(asset.ast, this.cliOpts))
    ) {
      await this.generate(previousTransformer, asset, previousConfig);
    }

    if (!asset.ast && transformer.parse) {
      asset.ast = await transformer.parse(asset, config, this.cliOpts);
    }

    // Transform the AST.
    let assets = [asset];
    if (transformer.transform) {
      assets = await transformer.transform(asset, config, this.cliOpts);
    }

    return assets;
  }

  async generate(
    transformer: Transformer,
    asset: TransformerAsset,
    config: Config
  ) {
    let output = await transformer.generate(asset, config, this.cliOpts);
    asset.output = output;
    asset.code = output.code;
    asset.ast = null;
  }
}

module.exports = TransformerRunner;

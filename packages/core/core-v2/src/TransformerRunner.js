const micromatch = require('micromatch');
const localRequire = require('@parcel/utils/localRequire');
const path = require('path');
const Asset = require('./Asset');
const clone = require('clone');
const md5 = require('@parcel/utils/md5');
const Cache = require('@parcel/cache-v2');
const fs = require('@parcel/fs');

class TransformerRunner {
  constructor({ parcelConfig, cliOpts }) {
    this.cliOpts = cliOpts;
    this.parcelConfig = parcelConfig;
    this.cache = new Cache(cliOpts);
  }

  async transform(asset) {
    asset = new Asset(asset);
    if (!asset.code) {
      asset.code = await fs.readFile(asset.filePath, 'utf8');
    }

    let hash = md5(asset.code);

    let cacheEntry = await this.cache.read(asset.filePath);
    if (cacheEntry && cacheEntry.hash === hash) {
      return cacheEntry;
    }

    let pipeline = await this.resolvePipeline(asset);
    let {children, results} = await this.runPipeline(asset, pipeline, cacheEntry);
    cacheEntry = {
      hash,
      children,
      results: results === children ? null : results
    };

    await this.cache.writeBlobs(cacheEntry);

    await this.cache.write(asset.filePath, cacheEntry);
    return cacheEntry;
  }

  async resolvePipeline(asset) {
    for (let pattern in this.parcelConfig.transforms) {
      if (micromatch.isMatch(asset.filePath, pattern) || micromatch.isMatch(path.basename(asset.filePath), pattern)) {
        return Promise.all(this.parcelConfig.transforms[pattern].map(
          async transform => await localRequire(transform, asset.filePath)
        ));
      }
    }
  }

  async runPipeline(asset, pipeline, cacheEntry, previousTransformer = null, previousConfig = null) {
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

    let assets = await this.runTransform(asset, transformer, config, previousTransformer, previousConfig);

    let children = [];
    for (let subAsset of assets) {
      subAsset = subAsset instanceof Asset ? subAsset : new Asset(subAsset, asset);

      if (!previousTransformer) {
        if (subAsset.ast) {
          this.generate(transformer, subAsset, config);
        }

        subAsset.hash = md5(subAsset.code);

        if (cacheEntry) {
          let cachedChildren = cacheEntry.children.filter(child => child.hash === subAsset.hash);
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
            (await this.runPipeline(subAsset, pipeline.slice(1), cacheEntry, transformer, config)).results
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
      results = await transformer.postProcess(children, config, options);
    }

    return {children, results};
  }

  async runTransform(asset, transformer, config, previousTransformer, previousConfig) {
    // let shouldTransform = transformer.transform && (!transformer.shouldTransform || transformer.shouldTransform(asset, options));
    // let mightHaveDependencies = transformer.getDependencies && (!transformer.mightHaveDependencies || transformer.mightHaveDependencies(asset, options));

    if (asset.ast && (!transformer.canReuseAST || !transformer.canReuseAST(asset.ast, this.cliOpts))) {
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

  async generate(transformer, asset, config) {
    let output = await transformer.generate(asset, config, this.cliOpts);
    asset.blobs = output;
    asset.code = output.code;
    asset.ast = null;
  }
}

module.exports = TransformerRunner;

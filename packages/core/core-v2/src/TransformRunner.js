const micromatch = require('micromatch');
const localRequire = require('@parcel/utils/localRequire');
const path = require('path');
const Asset = require('./Asset');

class TransformRunner {
  constructor(parcelConfig, options) {
    this.options = options;
    this.parcelConfig = parcelConfig;
  }

  async transformAsset(asset) {
    asset = new Asset(asset);
    let pipeline = await this.resolvePipeline(asset);
    return await this.runPipeline(asset, pipeline);
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

  async runPipeline(asset, pipeline, previousTransformer = null, previousConfig = null) {
    // Run the first transformer in the pipeline.
    let transformer = pipeline[0];

    let config = null;
    if (transformer.getConfig) {
      let result = await transformer.getConfig(asset, this.options);
      if (result) {
        config = result.config;
        // TODO: do something with deps
      }
    }

    let assets = await this.transform(asset, transformer, config, previousTransformer, previousConfig);

    let result = [];
    for (let subAsset of assets) {
      subAsset = subAsset instanceof Asset ? subAsset : new Asset(subAsset, asset);

      // If the generated asset has the same type as the input...
      if (subAsset.type === asset.type) {
        // If we have reached the last transform in the pipeline, then we are done.
        if (pipeline.length === 1) {
          if (subAsset.ast) {
            await this.generate(transformer, subAsset, config);
          }

          result.push(subAsset);

        // Otherwise, recursively run the remaining transforms in the pipeline.
        } else {
          result = result.concat(
            await this.runPipeline(subAsset, pipeline.slice(1), transformer, config)
          );
        }

      // Otherwise, jump to a different pipeline for the generated asset.
      } else {
        result = result.concat(
          await this.runPipeline(
            subAsset,
            await this.resolvePipeline(subAsset),
            transformer,
            config
          )
        );
      }
    }

    // If the transformer has a postProcess function, execute that with the result of the pipeline.
    if (transformer.postProcess) {
      result = await transformer.postProcess(result);
    }

    return result;
  }

  async transform(asset, transformer, config, previousTransformer, previousConfig) {
    // let shouldTransform = transformer.transform && (!transformer.shouldTransform || transformer.shouldTransform(asset, options));
    // let mightHaveDependencies = transformer.getDependencies && (!transformer.mightHaveDependencies || transformer.mightHaveDependencies(asset, options));

    if (asset.ast && (!transformer.canReuseAST || !transformer.canReuseAST(asset.ast, this.options))) {
      await this.generate(previousTransformer, asset, previousConfig);
    }

    if (!asset.ast && transformer.parse) {
      asset.ast = await transformer.parse(asset, config, this.options);
    }

    // Transform the AST.
    let assets = [asset];
    if (transformer.transform) {
      assets = await transformer.transform(asset, config, this.options);
    }

    // Get dependencies.
    // let dependencies;
    // if (transformer.getDependencies) {
    //   dependencies = await transformer.getDependencies(asset, options);
    // }

    // return await transformer.generate(asset, asset.ast, options);
    return assets;
  }

  async generate(transformer, asset, config) {
    let output = await transformer.generate(asset, config, this.options);
    asset.code = output.code;
    asset.map = output.map;
    asset.ast = null;
  }
}

module.exports = TransformRunner;

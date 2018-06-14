const Parser = require('./Parser');
const path = require('path');
const md5 = require('./utils/md5');

/**
 * A Pipeline composes multiple Asset types together.
 */
class Pipeline {
  constructor(options) {
    this.options = options;
    this.parser = new Parser(options);
  }

  async process(path, id, isWarmUp) {
    let options = this.options;
    if (isWarmUp) {
      options = Object.assign({isWarmUp}, options);
    }

    let asset = this.parser.getAsset(path, options);
    asset.id = id;

    let generated = await this.processAsset(asset);
    let generatedMap = {};
    for (let rendition of generated) {
      generatedMap[rendition.type] = rendition.value;
    }

    return {
      dependencies: Array.from(asset.dependencies.values()),
      generated: generatedMap,
      hash: asset.hash,
      cacheData: asset.cacheData
    };
  }

  async processAsset(asset) {
    try {
      await asset.process();
    } catch (err) {
      throw asset.generateErrorMessage(err);
    }

    let inputType = path.extname(asset.name).slice(1);
    let generated = [];

    for (let rendition of this.iterateRenditions(asset)) {
      let {type, value} = rendition;
      if (typeof value !== 'string' || rendition.final) {
        generated.push(rendition);
        continue;
      }

      // Find an asset type for the rendition type.
      // If the asset is not already an instance of this asset type, process it.
      let AssetType = this.parser.findParser(
        asset.name.slice(0, -inputType.length) + type,
        true
      );
      if (!(asset instanceof AssetType)) {
        let opts = Object.assign({}, asset.options, {rendition});
        let subAsset = new AssetType(asset.name, opts);
        subAsset.id = asset.id;
        subAsset.contents = value;
        subAsset.dependencies = asset.dependencies;
        subAsset.cacheData = Object.assign(asset.cacheData, subAsset.cacheData);

        let processed = await this.processAsset(subAsset);
        generated = generated.concat(processed);
        asset.hash = md5(asset.hash + subAsset.hash);
      } else {
        generated.push(rendition);
      }
    }

    // Post process. This allows assets a chance to modify the output produced by sub-asset types.
    asset.generated = generated;
    try {
      generated = await asset.postProcess(generated);
    } catch (err) {
      throw asset.generateErrorMessage(err);
    }

    return generated;
  }

  *iterateRenditions(asset) {
    if (Array.isArray(asset.generated)) {
      return yield* asset.generated;
    }

    if (typeof asset.generated === 'string') {
      return yield {
        type: asset.type,
        value: asset.generated
      };
    }

    // Backward compatibility support for the old API.
    // Assume all renditions are final - don't compose asset types together.
    for (let type in asset.generated) {
      yield {
        type,
        value: asset.generated[type],
        // for scope hoisting, we need to post process all JS
        final: !(type === 'js' && this.options.scopeHoist)
      };
    }
  }
}

module.exports = Pipeline;

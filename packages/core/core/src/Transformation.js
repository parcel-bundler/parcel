// @flow
import path from 'path';
import {md5FromString} from '@parcel/utils/src/md5';
import Cache from '@parcel/cache';
import * as fs from '@parcel/fs';
import clone from 'clone';
import Asset from './Asset';

export default class Transformation {
  constructor({request, loadConfig, node, options}) {
    this.request = request;
    this.loadConfig = configRequest => loadConfig(configRequest, node);
    this.options = options;
  }

  async run() {
    let asset = await this.loadAsset();

    return this.runPipeline(asset);
  }

  async runPipeline(initialAsset) {
    let {pipeline, configs} = await this.loadPipeline(initialAsset.filePath);

    let cacheKey = this.getCacheKey(initialAsset, configs);
    let cacheEntry = await Cache.get(cacheKey);

    if (cacheEntry) console.log('CACHE ENTRY FOUND');
    else console.log('TRANSFORMING', this.request);

    let assets = cacheEntry || (await pipeline.transform(initialAsset));

    let finalAssets = [];
    for (let asset of assets) {
      if (asset.type !== initialAsset.type) {
        let nextPipelineAssets = this.runPipeline(asset);
        finalAssets = finalAssets.concat(nextPipelineAssets);
      } else {
        finalAssets.push(asset);
      }
    }

    let processedFinalAssets = await Promise.all(
      finalAssets.map(
        asset => (pipeline.postProcess ? pipeline.postProcess(asset) : asset)
      )
    );

    Cache.set(cacheKey, processedFinalAssets);

    return processedFinalAssets;
  }

  getCacheKey(asset, configs) {
    return md5FromString(JSON.stringify({content: asset.code, configs}));
  }

  async loadAsset() {
    let {filePath, env, code} = this.request;

    return new Asset({
      filePath: filePath,
      type: path.extname(filePath).slice(1),
      ast: null,
      code: code || (await fs.readFile(filePath, 'utf8')),
      env: env
    });
  }

  async loadPipeline(filePath) {
    let configRequest = {
      filePath,
      meta: {
        actionType: 'transformation'
      }
    };

    let parcelConfig = await this.loadConfig(configRequest);
    let configs = {parcel: parcelConfig.content.getTransformerNames(filePath)};

    for (let [moduleName] of parcelConfig.devDeps) {
      let plugin = await parcelConfig.content.loadPlugin(moduleName);
      // TODO: implement loadPlugin in existing plugins that require config
      if (plugin.loadConfig) {
        configs[moduleName] = await this.loadTransformerConfig(
          filePath,
          moduleName,
          parcelConfig.resolvedPath
        ).content;
      }
    }

    let pipeline = new Pipeline(
      await parcelConfig.content.getTransformers(filePath),
      configs,
      this.options
    );

    return {pipeline, configs};
  }

  async loadTransformerConfig(filePath, plugin, parcelConfigPath) {
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
  constructor(transformers, configs, options) {
    this.transformers = transformers;
    this.options = options;
  }

  async transform(initialAsset) {
    let inputAssets = [initialAsset];
    let resultingAssets;
    let finalAssets = [];
    for (let transformer of this.transformers) {
      resultingAssets = [];
      for (let asset of inputAssets) {
        if (asset.type !== initialAsset.type) {
          finalAssets.push(asset);
        } else {
          resultingAssets = resultingAssets.concat(
            await this.runTransformer(asset, transformer)
          );
        }
      }

      inputAssets = resultingAssets;
    }

    finalAssets = finalAssets.concat(resultingAssets);

    return finalAssets;
  }

  async runTransformer(asset, transformer) {
    // Load config for the transformer.
    let config = null;
    if (transformer.getConfig) {
      config = await transformer.getConfig(asset, this.options);
    }

    // If an ast exists on the asset, but we cannot reuse it,
    // use the previous transform to generate code that we can re-parse.
    if (
      asset.ast &&
      (!transformer.canReuseAST ||
        !transformer.canReuseAST(asset.ast, this.options)) &&
      this.generate
    ) {
      let output = await this.generate(asset);
      asset.output = output;
      asset.code = output.code;
      asset.ast = null;
    }

    // Parse if there is no AST available from a previous transform.
    if (!asset.ast && transformer.parse) {
      asset.ast = await transformer.parse(asset, config, this.options);
    }

    // Transform.
    let results = await transformer.transform(asset, config, this.options);

    // Create generate and postProcess functions that can be called later
    this.generate = async (asset: Asset): Promise<AssetOutput> => {
      if (transformer.generate) {
        return transformer.generate(asset, config, this.options);
      }

      throw new Error(
        'Asset has an AST but no generate method is available on the transform'
      );
    };
    this.postProcess = async (
      assets: Array<IAsset>
    ): Promise<Array<Asset> | null> => {
      if (transformer.postProcess) {
        // TODO: figure out why clone is needed and add an explanatory comment
        assets = clone(assets);
        let results = await transformer.postProcess(
          assets,
          config,
          this.options
        );

        return Promise.all(
          results.map(result => asset.createChildAsset(result))
        );
      }

      return assets;
    };

    return results;
  }
}

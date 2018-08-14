const micromatch = require('micromatch');
const localRequire = require('@parcel/utils/localRequire');
const path = require('path');

class TransformRunner {
  constructor(parcelConfig, options) {
    this.options = options;
    this.parcelConfig = parcelConfig;
  }

  async transformModule(module) {
    let pipeline = await this.resolvePipeline(module);
    return await this.runPipeline(module, pipeline);
  }

  async resolvePipeline(module) {
    for (let pattern in this.parcelConfig.transforms) {
      if (micromatch.isMatch(module.name, pattern) || micromatch.isMatch(path.basename(module.name), pattern)) {
        return Promise.all(this.parcelConfig.transforms[pattern].map(
          async transform => await localRequire(transform, module.name)
        ));
      }
    }
  }

  toModule(parent, child) {
    child = Object.assign({}, parent, child);
    child.name = parent.name.slice(0, -parent.type.length) + child.type;
    return child
  }

  async runPipeline(module, pipeline, previousTransformer = null, previousConfig = null) {
    // Run the first transformer in the pipeline.
    let transformer = pipeline[0];

    let config = null;
    if (transformer.getConfig) {
      let result = await transformer.getConfig(module, this.options);
      if (result) {
        config = result.config;
        // TODO: do something with deps
      }
    }

    let modules = await this.transform(module, transformer, config, previousTransformer, previousConfig);

    let result = [];
    for (let subModule of modules) {
      subModule = this.toModule(module, subModule);

      // If the generated module has the same type as the input...
      if (subModule.type === module.type) {
        // If we have reached the last transform in the pipeline, then we are done.
        if (pipeline.length === 1) {
          if (module.ast) {
            await this.generate(transformer, module, config);
          }

          result.push(subModule);

        // Otherwise, recursively run the remaining transforms in the pipeline.
        } else {
          result = result.concat(
            await this.runPipeline(subModule, pipeline.slice(1), transformer, config)
          );
        }

      // Otherwise, jump to a different pipeline for the generated module.
      } else {
        result = result.concat(
          await this.runPipeline(
            subModule,
            await this.resolvePipeline(subModule),
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

  async transform(module, transformer, config, previousTransformer, previousConfig) {
    // let shouldTransform = transformer.transform && (!transformer.shouldTransform || transformer.shouldTransform(module, options));
    // let mightHaveDependencies = transformer.getDependencies && (!transformer.mightHaveDependencies || transformer.mightHaveDependencies(module, options));

    if (module.ast && (!transformer.canReuseAST || !transformer.canReuseAST(module.ast, this.options))) {
      await this.generate(previousTransformer, module, previousConfig);
    }

    if (!module.ast && transformer.parse) {
      module.ast = await transformer.parse(module, config, this.options);
    }

    // Transform the AST.
    let modules = [module];
    if (transformer.transform) {
      modules = await transformer.transform(module, config, this.options);
    }

    // Get dependencies.
    // let dependencies;
    // if (transformer.getDependencies) {
    //   dependencies = await transformer.getDependencies(module, options);
    // }

    // return await transformer.generate(module, module.ast, options);
    return modules;
  }

  async generate(transformer, module, config) {
    let output = await transformer.generate(module, config, this.options);
    module.code = output.code;
    module.map = output.map;
    module.ast = null;
  }
}

module.exports = Pipeline;

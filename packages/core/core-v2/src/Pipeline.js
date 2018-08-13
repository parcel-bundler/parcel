const minimatch = require('minimatch');
const localRequire = require('@parcel/utils/localRequire');

class Pipeline {
  constructor(options, parcelConfig) {
    this.options = options;
    this.parcelConfig = parcelConfig;
  }

  async resolvePipeline(module) {
    for (let pattern in this.parcelConfig.transforms) {
      if (minimatch(module.name, pattern)) {
        return Promise.all(this.parcelConfig.transforms.map(
          async transform => await localRequire(transform, module.name)
        ));
      }
    }
  }

  async runPipeline(module, pipeline, previousTransformer = null) {
    // Run the first transformer in the pipeline.
    let transformer = pipeline[0];
    let modules = await this.transform(module, transformer, previousTransformer);

    let result = [];
    for (let subModule of modules) {
      // If the generated module has the same type as the input...
      if (subModule.type === module.type) {
        // If we have reached the last transform in the pipeline, then we are done.
        if (pipeline.length === 1) {
          if (module.ast) {
            await this.generate(transformer, module);
          }

          result.push(subModule);

        // Otherwise, recursively run the remaining transforms in the pipeline.
        } else {
          result = result.concat(
            await this.runPipeline(subModule, pipeline.slice(1), transformer)
          );
        }

      // Otherwise, jump to a different pipeline for the generated module.
      } else {
        result = result.concat(
          await this.runPipeline(
            subModule,
            await resolvePipeline(subModule),
            transformer
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

  async transform(module, transformer, previousTransformer) {
    // let shouldTransform = transformer.transform && (!transformer.shouldTransform || transformer.shouldTransform(module, options));
    // let mightHaveDependencies = transformer.getDependencies && (!transformer.mightHaveDependencies || transformer.mightHaveDependencies(module, options));

    if (module.ast && (!transformer.canReuseAST || !transformer.canReuseAST(module.ast, this.options))) {
      await this.generate(previousTransformer, module);
    }

    if (!module.ast && transformer.parse) {
      module.ast = await transformer.parse(module, this.options);
    }

    // Transform the AST.
    let modules = [module];
    if (transformer.transform) {
      modules = await transformer.transform(module, this.options);
    }

    // Get dependencies.
    // let dependencies;
    // if (transformer.getDependencies) {
    //   dependencies = await transformer.getDependencies(module, options);
    // }

    // return await transformer.generate(module, module.ast, options);
    return modules;
  }

  async generate(transformer, module) {
    let output = await transformer.generate(module, this.options);
    module.code = output.code;
    module.map = output.map;
    module.ast = null;
  }
}

module.exports = Pipeline;

type Module = {
  id: ModuleId,
  env: ModuleEnvironment,
  type: FileType,
  code: string,
  map: SourceMap | null,
  ast: AST | null,
  maybeHasDependencies: boolean,
  dependencies: Array<Dependency>,
  meta: JSONObject
};

type AST = {
  type: string,
  version: string,
  program: JSONObject
};

type Transformer = {
  // If the asset is cached, this function would be called to allow a transformer to invalidate it.
  // For example, the JS transformer inserts environment variables into the code. It can keep track
  // of which environment variables were used and their values in the cache (via module.meta), and
  // invalidate the asset if any of those environment variables change.
  async shouldInvalidateCache(module: Module, options: Options): boolean,

  // If an asset is not already cached, we first need to check if we can reuse an
  // existing AST for this module from a previous step in the pipeline or if we need to re-parse.
  async canReuseAST(ast: AST): boolean,

  // If we need to re-parse, this function does that and returns an AST.
  async parse(module: Module, options: Options): AST,

  // Returns whether the transform step needs to run. If not, we can avoid parsing.
  // async shouldTransform(module: Module, options: Options): boolean,

  // This function is the core of the transformer. It transforms an AST into a new AST.
  async transform(module: Module, options: Options): Array<Module>,

  // This function is used as a quick check to see if an asset might have dependencies, e.g.
  // based on a regex test. If a module does not have any dependencies, and does not need transforming,
  // we may be able to avoid parsing it altogether for better performance.
  // async shouldGetDependencies(module: Module, options: Options): boolean,

  // This function is called to extract dependencies from an AST.
  // It can be skipped if a previous transform in a pipeline specifies that all
  // dependencies have already been extracted.
  // async getDependencies(module: Module, options: Options): Array<Dependency>,

  // This function turns an AST back into source code in the form of a new Module object,
  // or perhaps multiple output Modules in the case of a multi-part file e.g. Vue SFCs.
  // These Modules are then processed in turn by their associated transform pipelines.
  async generate(module: Module, options: Options): Module,

  // This function is called after all of the modules produced by `generate` are fully
  // processed. This allows the parent transformer to use the results of processed children
  // to modify the result in some way.
  async postProcess(modules: Array<Module>, options: Options): Array<Module>
};

['@parcel/transform-babel', '@parcel/transform-js', '@parcel/transform-uglify'] // PARSE + TRANSFORM; TRANSFORM + GET DEPS + GENERATE; PARSE + TRANSFORM + GENERATE
['@parcel/transform-babel', '@parcel/transform-js', '@parcel/transform-babel-minify'] // PARSE + TRANSFORM; TRANSFORM + GET DEPS; TRANSFORM + GENERATE
['@parcel/transform-babel', '@parcel/transform-sweetjs', '@parcel/transform-js'] // PARSE + TRANSFORM + GENERATE; PARSE + TRANSFORM + GENERATE; PARSE + TRANSFORM + GENERATE

['my-fancy-vue-transform', '@parcel/transform-vue'] // PARSE + TRANSFORM;
['@parcel/transform-posthtml', '@parcel/transform-html', '@parcel/transform-htmlnano'] // PARSE + TRANSFORM; TRANSFORM + GET DEPS; TRANSFORM + GENERATE

async function transform(
  module: Module,
  transformer: Transformer,
  options: Options
): Array<Module> {
  let shouldTransform = transformer.transform && (!transformer.shouldTransform || transformer.shouldTransform(module, options));
  let mightHaveDependencies = transformer.getDependencies && (!transformer.mightHaveDependencies || transformer.mightHaveDependencies(module, options));
  let shouldParse = (shouldTransform || mightHaveDependencies) && !(module.ast && transformer.canReuseAST && transformer.canReuseAST(module, module.ast. options));

  if (module.ast && (!transformer.canReuseAST || !transformer.canReuseAST(module, module.ast, options))) {
    module.code = previousTransformer.generate(module, module.ast, options);
    module.ast = null;
  }

  if (shouldParse) {
    module.ast = await transformer.parse(module, options);
  }

  // Transform the AST.
  if (shouldTransform) {
    module.ast = await transformer.transform(module, module.ast, options);
  }

  // Get dependencies.
  let dependencies;
  if (mightHaveDependencies) {
    dependencies = await transformer.getDependencies(module, module.ast, options);
  }

  return await transformer.generate(module, module.ast, options);
}

async function runPipeline(
  module: Module,
  pipeline: Array<Transformer>,
  options: Options
): Array<Module> {
  // Run the first transformer in the pipeline.
  let transformer = pipeline[0];
  let modules = await transform(module, transformer, option);

  let result = [];
  for (let subModule of modules) {
    // If the generated module has the same type as the input...
    if (subModule.type === module.type) {
      // If we have reached the last transform in the pipeline, then we are done.
      if (pipeline.length === 1) {
        result.push(subModule);

      // Otherwise, recursively run the remaining transforms in the pipeline.
      } else {
        result = result.concat(
          await runPipeline(subModule, pipeline.slice(1), options)
        );
      }

    // Otherwise, jump to a different pipeline for the generated module.
    } else {
      result = result.concat(
        await runPipeline(
          subModule,
          await resolvePipeline(subModule, options),
          options
        )
      );
    }
  }

  // If the transformer has a postProcess function, execute that with the result of the pipeline.
  if (transformer.postProcess) {
    result = await transformer.postProcess(result, options);
  }

  return result;
}

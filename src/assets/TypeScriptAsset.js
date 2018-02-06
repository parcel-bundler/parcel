const path = require('path');
const JSAsset = require('./JSAsset');
const localRequire = require('../utils/localRequire');

class TypeScriptAsset extends JSAsset {
  async parse(code) {
    // require typescript, installed locally in the app
    let typescript = await localRequire('typescript', this.name);
    let transpilerOptions = {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        jsx: typescript.JsxEmit.Preserve
      }
    };

    let tsconfigPath = await this.getConfigPath(['tsconfig.json']);

    if (tsconfigPath) {
      let config = await this.loadConfig(tsconfigPath, ['tsconfig.json']);

      // Overwrite default if config is found
      transpilerOptions.compilerOptions = Object.assign(
        transpilerOptions.compilerOptions,
        config.compilerOptions
      );
      transpilerOptions.parcel = config.parcel;
    }

    transpilerOptions.compilerOptions.noEmit = false;
    transpilerOptions.compilerOptions.sourceMap = this.options.sourceMaps;

    // use TypeScript to parse the json to resolve filenames and support "extends"
    let configDir = path.dirname(tsconfigPath || this.name);
    let tsconfig = typescript.parseJsonConfigFileContent(
      transpilerOptions,
      typescript.sys,
      configDir
    );
    let transformersPath =
      transpilerOptions.parcel && transpilerOptions.parcel.transformers;
    let transformers = undefined;

    if (transformersPath) {
      if (typeof transformersPath !== 'string') {
        throw new Error(
          'The TypeScript option "parcel.transformers" should be a string'
        );
      }

      // Require the transformers factory module. It should be a CommonJS module
      let factoryPath = path.resolve(configDir, transformersPath);

      // Create the TypeScript transformer factory (cf. ts.TransformerFactory)
      transformers = require(factoryPath)();

      if (transformers.before && !Array.isArray(transformers.before)) {
        throw new Error(`CustomTransformers.before should be an array`);
      }
      if (transformers.after && !Array.isArray(transformers.after)) {
        throw new Error(`CustomTransformers.after should be an array`);
      }
    }

    // Transpile Module using TypeScript and parse result as ast format through babylon
    let transpiled = typescript.transpileModule(code, {
      compilerOptions: tsconfig.options,
      fileName: this.basename,
      transformers: transformers
    });
    this.sourceMap = transpiled.sourceMapText;

    if (this.sourceMap) {
      this.sourceMap = JSON.parse(this.sourceMap);
      this.sourceMap.sources = [this.relativeName];
      this.sourceMap.sourcesContent = [this.contents];

      // Remove the source map URL
      let content = transpiled.outputText;
      transpiled.outputText = content.substring(
        0,
        content.lastIndexOf('//# sourceMappingURL')
      );
    }

    this.contents = transpiled.outputText;
    return await super.parse(this.contents);
  }
}

module.exports = TypeScriptAsset;

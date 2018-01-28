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
      },
      fileName: this.relativeName
    };

    let tsconfig = await this.getConfig(['tsconfig.json']);

    // Overwrite default if config is found
    if (tsconfig) {
      transpilerOptions.compilerOptions = Object.assign(
        transpilerOptions.compilerOptions,
        tsconfig.compilerOptions
      );
    }
    transpilerOptions.compilerOptions.noEmit = false;
    transpilerOptions.compilerOptions.sourceMap = this.options.sourceMaps;

    // Transpile Module using TypeScript and parse result as ast format through babylon
    let transpiled = typescript.transpileModule(code, transpilerOptions);
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

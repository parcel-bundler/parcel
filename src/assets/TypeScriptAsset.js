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
      fileName: this.basename
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
    transpilerOptions.compilerOptions.sourceMap = this.options.sourcemaps;

    // Transpile Module using TypeScript and parse result as ast format through babylon
    let transpiled = typescript.transpileModule(code, transpilerOptions);
    this.sourcemap = transpiled.sourceMapText;
    if (this.sourcemap) {
      this.sourcemap = JSON.parse(this.sourcemap);
      this.sourcemap.sourcesContent = [this.contents];
    }
    this.contents = transpiled.outputText;
    return await super.parse(this.contents);
  }
}

module.exports = TypeScriptAsset;

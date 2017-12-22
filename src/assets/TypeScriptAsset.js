const JSAsset = require('./JSAsset');
const config = require('../utils/config');
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

    let tsconfig = await config.load(this.name, ['tsconfig.json']);

    // Overwrite default if config is found
    if (tsconfig) {
      transpilerOptions.compilerOptions = Object.assign(
        transpilerOptions.compilerOptions,
        tsconfig.compilerOptions
      );
    }
    transpilerOptions.compilerOptions.noEmit = false;

    // Transpile Module using TypeScript and parse result as ast format through babylon
    this.contents = typescript.transpileModule(
      code,
      transpilerOptions
    ).outputText;
    return await super.parse(this.contents);
  }
}

module.exports = TypeScriptAsset;

const JSAsset = require('./JSAsset');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');

class TypeScriptAsset extends JSAsset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    // require typescript, installed locally in the app
    this.typescript = localRequire('typescript', this.name);
  }

  async getConfig() {
    let transpilerOptions = {
      compilerOptions: {
        module: this.typescript.ModuleKind.CommonJS,
        jsx: this.typescript.JsxEmit.Preserve
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

    return transpilerOptions;
  }

  async parse(code) {
    let transpilerOptions = await this.getConfig();

    // Transpile Module using TypeScript and parse result as ast format through babylon
    this.contents = this.typescript.transpileModule(
      code,
      transpilerOptions
    ).outputText;

    return super.parse(this.contents);
  }
}

module.exports = TypeScriptAsset;

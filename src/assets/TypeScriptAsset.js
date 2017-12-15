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
    await super.getConfig();

    if (this.config.typescript) {
      return this.config;
    }

    this.config.typescript = {
      compilerOptions: {
        module: this.typescript.ModuleKind.CommonJS,
        jsx: this.typescript.JsxEmit.Preserve
      },
      fileName: this.basename
    };

    let tsconfig = await config.load(this.name, ['tsconfig.json']);

    // Overwrite default if config is found
    if (tsconfig) {
      this.config.typescript.compilerOptions = Object.assign(
        this.config.typescript.compilerOptions,
        tsconfig.compilerOptions
      );
    }
    this.config.typescript.compilerOptions.noEmit = false;

    return this.config.typescript;
  }

  async parse(code) {
    // Transpile Module using TypeScript and parse result as ast format through babylon
    this.contents = this.typescript.transpileModule(
      code,
      this.config.typescript
    ).outputText;

    return super.parse(this.contents);
  }
}

module.exports = TypeScriptAsset;

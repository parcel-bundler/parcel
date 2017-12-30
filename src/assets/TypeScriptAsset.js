const JSAsset = require('./JSAsset');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');

class TypeScriptAsset extends JSAsset {
  async getConfig() {
    await super.getConfig();
    let typescript = await localRequire('typescript', this.name);

    if (this.config.typescript) {
      return this.config;
    }

    this.config.typescript = {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        jsx: typescript.JsxEmit.Preserve
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
    let typescript = await localRequire('typescript', this.name);

    // Transpile Module using TypeScript and parse result as ast format through babylon
    this.contents = typescript.transpileModule(
      code,
      this.config.typescript
    ).outputText;

    return super.parse(this.contents);
  }
}

module.exports = TypeScriptAsset;

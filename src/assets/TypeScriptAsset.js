const JSAsset = require('./JSAsset');
const localRequire = require('../utils/localRequire');

class TypeScriptAsset extends JSAsset {
  async transform() {
    this.ast = await this.parse(this.contents);
    this.isAstDirty = true;
  }

  async parse(code) {
    // require typescript, installed locally in the app
    let typescript = localRequire('typescript', this.name);

    let transpilerOptions = {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        jsx: true
      },
      fileName: this.basename
    }

    // Transpile Module using TypeScript and parse result as ast format through babylon
    return await super.parse(typescript.transpileModule(code, transpilerOptions).outputText);
  }
}

module.exports = TypeScriptAsset;
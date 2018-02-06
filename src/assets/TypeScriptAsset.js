const JSAsset = require('./JSAsset');
const localRequire = require('../utils/localRequire');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');

/*
interface ParseConfigHostX {
  useCaseSensitiveFileNames: boolean;
  readDirectory(rootDir: string, extensions: ReadonlyArray<string>, excludes: ReadonlyArray<string>, includes: ReadonlyArray<string>, depth: number): string[];

  fileExists(path: string): boolean;
  readFile(path: string): string | undefined;
}
*/

class ParseConfigHost {
  constructor() {
    this.useCaseSensitiveFileNames = true;
    this.readFiles = [];
  }

  readDirectory(rootDir, extensions) {
    // excludes, includes, depth
    let results = fs.readdirSync(rootDir);

    if (extensions)
      results = results.filter(f => extensions.some(ext => f.endsWith(ext)));
    return results;
  }
  fileExists(path) {
    return fs.existsSync(path);
  }

  readFile(path) {
    this.readFiles.push(path);
    return fs.readFileSync(path, 'utf8');
  }
}

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

    let tsconfig = await this.readFullConfig(typescript, 'tsconfig.json');

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

  async readFullConfig(typescript, filepath) {
    let configPath = await config.resolve(this.name, [filepath]);
    let tsconfig = null;

    if (configPath != null) {
      // TypeScript's config parsing API requires the json content, even though that
      // can be provided by the passed ParseConfigHost and the configPath parameter
      tsconfig = await this.getConfig([filepath]);
      let host = new ParseConfigHost();
      let parsed = typescript.parseJsonConfigFileContent(
        tsconfig,
        host,
        path.dirname(configPath),
        configPath
      );

      // Only dependant JSON configs will end up in the file list, not the original one.
      host.readFiles.forEach(file =>
        this.addDependency(file, {includedInParent: true})
      );
      tsconfig = {compilerOptions: parsed.options};
    }
    return tsconfig;
  }
}

module.exports = TypeScriptAsset;

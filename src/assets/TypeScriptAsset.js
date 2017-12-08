const JSAsset = require('./JSAsset');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');

const compilerServices = new WeakMap();

class TypeScriptAsset extends JSAsset {
  async parse(code) {
    // Get the current build context shared TypeScript instance
    const services = await this.getCompilerService();

    // Transpile Module using TypeScript
    const output = services.getEmitOutput(this.name);

    // Merge all diagnostics
    const diags = services
      .getSyntacticDiagnostics(this.name)
      .concat(services.getSemanticDiagnostics(this.name));

    if (diags.length > 0) {
      // TODO: properly handle errors

      throw new Error(diags[0].messageText);
    }

    // TODO : properly match the file
    const file = output.outputFiles.pop(); //.find(output => output.name === this.name)
    const source = file && file.text;

    if (!source) {
      throw new Error('what should i do');
    }

    this.contents = source;

    // Parse result as ast format through babylon
    return super.parse(this.contents);
  }

  async getTsConfig(typescript) {
    const tsconfig = await config.load(this.name, ['tsconfig.json']);
    const transpilerOptions = {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        jsx: typescript.JsxEmit.Preserve
      },
      fileName: this.basename
    };

    // Overwrite default if config is found
    if (tsconfig) {
      transpilerOptions.compilerOptions = tsconfig.compilerOptions;
      transpilerOptions.files = tsconfig.files;
      transpilerOptions.include = tsconfig.include;
      transpilerOptions.exclude = tsconfig.exclude;
    }

    transpilerOptions.compilerOptions.noEmit = false;

    return transpilerOptions;
  }

  async getCompilerService() {
    // Fetch the instance linked to our parser
    let service = compilerServices.get(this.options.parser);

    // If we already have the service in cache let's reuse it
    if (service) {
      return service;
    }

    // Require typescript, installed locally in the app
    const typescript = localRequire('typescript', this.name);
    const config = await this.getTsConfig(typescript);

    // Turn the tsconfig object into TypeScript command line options
    const {fileNames, options} = typescript.parseJsonConfigFileContent(
      config,
      typescript.sys,
      // TODO: do not use process.cwd()
      process.cwd()
    );
    // We will keep a revision index for each source file here
    const files = {};

    // initialize the list of files
    fileNames.forEach(
      fileName =>
        (files[fileName] = {
          version: 0
        })
    );

    // A host to tell the service how to parse/handle the project
    const servicesHost = {
      getScriptFileNames: () => fileNames,
      getScriptVersion: fileName =>
        files[fileName] && files[fileName].version.toString(),
      getScriptSnapshot: fileName => {
        if (!typescript.sys.fileExists(fileName)) {
          return;
        }

        return typescript.ScriptSnapshot.fromString(
          typescript.sys.readFile(fileName)
        );
      },
      getCurrentDirectory: () => process.cwd(),
      getCompilationSettings: () => options,
      getDefaultLibFileName: options =>
        typescript.getDefaultLibFilePath(options),
      fileExists: typescript.sys.fileExists,
      readFile: typescript.sys.readFile,
      readDirectory: typescript.sys.readDirectory
    };

    // Create the language service host using the configuration and user options
    service = typescript.createLanguageService(
      servicesHost,
      typescript.createDocumentRegistry()
    );

    // Save the service for a future use
    compilerServices.set(this.options.parser, service);

    return service;
  }
}

module.exports = TypeScriptAsset;

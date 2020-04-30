// @flow
import type {DiagnosticCodeFrame} from '@parcel/diagnostic';
import type {
  Asset,
  ConfigResult,
  PluginOptions,
  ValidateResult,
} from '@parcel/types';
import type {LanguageService, Diagnostic} from 'typescript'; // eslint-disable-line import/no-extraneous-dependencies

import path from 'path';
import {md5FromObject} from '@parcel/utils';
import {Validator} from '@parcel/plugin';
import {LanguageServiceHost, ParseConfigHost} from '@parcel/ts-utils';

let langServiceCache: {
  [configHash: string]: {|
    configHost: ParseConfigHost,
    host: LanguageServiceHost,
    service: LanguageService,
    skipLibCheck: boolean,
  |},
  ...,
} = {};

let langServicesToFinalize = new Set</* configHash */ string>();

type TSValidatorConfig = {|
  filepath: string | null,
  baseDir: string,
  configHash: string,
  tsconfig: ConfigResult | null,
|};

export default new Validator({
  async validateAll({
    assets,
    options,
    resolveConfigWithPath,
    getAllDependentAssets,
  }): Promise<Array<?ValidateResult>> {
    // Build a collection that relates the assets that need to be validated to a particular LanguageService that will do the validating.
    // This assumes that any given file can only have a single config.
    let assetsToValidate = new Map<
      /* filePath */ string,
      /* configHash */ string,
    >();

    await Promise.all(
      assets.map(async asset => {
        let config = await getConfig(asset, options, resolveConfigWithPath);
        let {configHash} = config;

        // Create a languageService/host in the cache for the configuration if it doesn't already exist.
        await tryCreateLanguageService(
          config,
          asset,
          options,
          assetsToValidate,
        );
        if (!langServiceCache[configHash]) return;

        // If skipLibCheck is true, that means tryCreateLanguageService didn't add the program's files to assetsToValidate - we need to do it ourselves using parcel's dependency graph.
        if (langServiceCache[configHash].skipLibCheck) {
          // Invalidate the file with the LanguageServiceHost so Typescript knows it has changed.
          langServiceCache[configHash].host.invalidate(asset.filePath);

          assetsToValidate.set(asset.filePath, configHash);

          getAllDependentAssets(asset.assetGraphNodeId).forEach(
            dependentAsset => {
              assetsToValidate.set(dependentAsset.filePath, configHash);
            },
          );
        }
      }),
    );

    // After we've done our first validation of a given project (which, if tsconfig.json skipLibCheck=false, will include d.ts files specified in 'lib' or 'typeRoots'),
    // we don't need to re-validate the 'lib' or 'typeRoots' d.ts files on subsequent Validations.
    if (langServicesToFinalize.size > 0) {
      langServicesToFinalize.forEach(
        configHash => (langServiceCache[configHash].skipLibCheck = true),
      );
      langServicesToFinalize.clear();
    }

    // Ask typescript to analyze all changed programs and translate the results into ValidatorResult objects.
    let validatorResults: Array<?ValidateResult> = [];
    assetsToValidate.forEach((configHash, assetPath) => {
      // Make sure that the filesystem being used by the LanguageServiceHost and ParseConfigHost is up-to-date.
      // (This could change in the context of re-running tests, and probably also for other reasons).
      langServiceCache[configHash].host.fs = options.inputFS;
      langServiceCache[configHash].configHost.fs = options.inputFS;

      const diagnostics = langServiceCache[
        configHash
      ].service.getSemanticDiagnostics(assetPath);
      validatorResults.push(
        getValidateResultFromDiagnostics(assetPath, diagnostics),
      );
    });

    return validatorResults;
  },
});

async function getConfig(
  asset,
  options,
  resolveConfigWithPath,
): Promise<TSValidatorConfig> {
  let configNames = ['tsconfig.json'];
  let tsconfig = await asset.getConfig(configNames);
  let configPath: string | null = await resolveConfigWithPath(
    configNames,
    asset.filePath,
  );
  let baseDir = configPath ? path.dirname(configPath) : options.projectRoot;
  let configHash = (tsconfig ? md5FromObject(tsconfig) : '') + '-' + baseDir;

  return {
    filepath: configPath,
    baseDir,
    configHash,
    tsconfig,
  };
}

/** Tries to create a typescript language service instance in the cache if it doesn't already exist. */
async function tryCreateLanguageService(
  config: TSValidatorConfig,
  asset: Asset,
  options: PluginOptions,
  assetsToValidate: Map</* filePath */ string, /* configHash */ string>,
): Promise<void> {
  if (config.tsconfig && !langServiceCache[config.configHash]) {
    let ts = await options.packageManager.require(
      'typescript',
      asset.filePath,
      {autoinstall: options.autoinstall},
    );

    // In order to prevent race conditions where we accidentally create two language services for the same config,
    // we need to re-check the cache to see if a service has been created while we were awaiting 'ts'.
    if (!langServiceCache[config.configHash]) {
      let configHost = new ParseConfigHost(options.inputFS, ts);
      let parsedCommandLine = ts.parseJsonConfigFileContent(
        config.tsconfig,
        configHost,
        config.baseDir,
      );
      const host = new LanguageServiceHost(
        options.inputFS,
        ts,
        parsedCommandLine,
      );
      let service = ts.createLanguageService(host, ts.createDocumentRegistry());

      // The first time the language service is created, we want to check all files in the project if skipLibCheck = false (the default).
      // See: https://www.typescriptlang.org/docs/handbook/compiler-options.html
      let skipLibCheck =
        config.tsconfig?.compilerOptions?.skipLibCheck ?? false;
      if (!skipLibCheck) {
        // ANDREW_TODO: should we also somehow ask Parcel to monitor the 'lib' and 'typeRoots' d.ts files for changes?
        let allSourceFiles = service.getProgram()?.getSourceFiles() ?? [];
        allSourceFiles.forEach(sourceFile => {
          host.invalidate(asset.filePath);
          assetsToValidate.set(sourceFile.fileName, config.configHash);
        });
        langServicesToFinalize.add(config.configHash);
      }

      langServiceCache[config.configHash] = {
        configHost,
        host,
        service,
        skipLibCheck,
      };
    }
  }
}

/** Translates semantic diagnostics (from TypeScript) into a ValidateResult that Parcel understands. */
function getValidateResultFromDiagnostics(
  filePath: string,
  diagnostics: $ReadOnlyArray<Diagnostic>,
): ValidateResult {
  let validatorResult = {
    warnings: [],
    errors: [],
  };

  if (diagnostics.length > 0) {
    for (let diagnostic of diagnostics) {
      let filename = filePath;
      let {file} = diagnostic;

      let diagnosticMessage =
        typeof diagnostic.messageText === 'string'
          ? diagnostic.messageText
          : diagnostic.messageText.messageText;

      let codeframe: ?DiagnosticCodeFrame;
      if (file != null && diagnostic.start != null) {
        let source = file.text || diagnostic.source;
        if (file.fileName) {
          filename = file.fileName;
        }

        if (source) {
          let lineChar = file.getLineAndCharacterOfPosition(diagnostic.start);
          let start = {
            line: lineChar.line + 1,
            column: lineChar.character + 1,
          };
          let end = {
            line: start.line,
            column: start.column + 1,
          };

          if (typeof diagnostic.length === 'number') {
            let endCharPosition = file.getLineAndCharacterOfPosition(
              diagnostic.start + diagnostic.length,
            );

            end = {
              line: endCharPosition.line + 1,
              column: endCharPosition.character + 1,
            };
          }

          codeframe = {
            code: source,
            codeHighlights: {
              start,
              end,
              message: diagnosticMessage,
            },
          };
        }
      }

      validatorResult.errors.push({
        origin: '@parcel/validator-typescript',
        message: diagnosticMessage,
        filePath: filename,
        codeFrame: codeframe ? codeframe : undefined,
      });
    }
  }

  return validatorResult;
}

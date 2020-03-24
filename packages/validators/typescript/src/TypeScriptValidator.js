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
  |},
  ...,
} = {};

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
  }): Promise<Array<?ValidateResult>> {
    // Build a collection that relates the assets that need to be validated to a particular LanguageService that will do the validating.
    let assetsToValidate: Array<{|configHash: string, asset: Asset|}> = [];
    await Promise.all(
      assets.map(async asset => {
        let config = await getConfig(asset, options, resolveConfigWithPath);
        let {configHash} = config;

        // Create a languageService/host in the cache for the configuration if it doesn't already exist.
        await tryCreateLanguageService(config, asset, options);
        if (!langServiceCache[configHash]) return;

        // Invalidate the file with the LanguageServiceHost so Typescript knows it has changed.
        langServiceCache[configHash].host.invalidate(asset.filePath);

        assetsToValidate.push({configHash, asset});
      }),
    );

    // Ask typescript to analyze all changed files and translate the results into ValidatorResult objects.
    let validatorResults: Array<?ValidateResult> = [];
    assetsToValidate.forEach(({configHash, asset}) => {
      // Make sure that the filesystem being used by the LanguageServiceHost and ParseConfigHost is up-to-date.
      // (This could change in the context of re-running tests, and probably also for other reasons).
      langServiceCache[configHash].host.fs = options.inputFS;
      langServiceCache[configHash].configHost.fs = options.inputFS;

      const diagnostics = langServiceCache[
        configHash
      ].service.getSemanticDiagnostics(asset.filePath);

      validatorResults.push(
        getValidateResultFromDiagnostics(asset, diagnostics),
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
      langServiceCache[config.configHash] = {
        configHost,
        host,
        service: ts.createLanguageService(host, ts.createDocumentRegistry()),
      };
    }
  }
}

/** Translates semantic diagnostics (from TypeScript) into a ValidateResult that Parcel understands. */
function getValidateResultFromDiagnostics(
  asset: Asset,
  diagnostics: Diagnostic[],
): ValidateResult {
  let validatorResult = {
    warnings: [],
    errors: [],
  };

  if (diagnostics.length > 0) {
    for (let diagnostic of diagnostics) {
      let filename = asset.filePath;
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

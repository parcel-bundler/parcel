// @flow
import type {DiagnosticCodeFrame} from '@parcel/diagnostic';
import type {ValidateResult, Asset} from '@parcel/types';

import path from 'path';
import {md5FromObject} from '@parcel/utils';
import {Validator} from '@parcel/plugin';
import {LanguageServiceHost, ParseConfigHost} from '@parcel/ts-utils';

let langServiceCache: {
  [configHash: string]: {|
    configHost: ParseConfigHost,
    host: LanguageServiceHost,
    service: any,
  |},
  ...,
} = {};

export default new Validator({
  async validateAll({
    assets,
    options,
    resolveConfigWithPath,
  }): Promise<Array<?ValidateResult>> {
    // ANDREW_TODO: refactor this for clarity.
    // Build a collection that relates the assets that need to be validated to a particular LanguageService that will do the validating.
    let assetsToValidate: Array<{|configHash: string, asset: Asset|}> = [];
    await Promise.all(
      assets.map(async asset => {
        let ts = await options.packageManager.require(
          'typescript',
          asset.filePath,
        );

        // Get configuration for each asset.
        let configNames = ['tsconfig.json'];
        let tsconfig = await asset.getConfig(configNames);
        let configPath: string | null = await resolveConfigWithPath(
          configNames,
          asset.filePath,
        );
        let baseDir = configPath
          ? path.dirname(configPath)
          : options.projectRoot;
        let configHash =
          (tsconfig ? md5FromObject(tsconfig) : '') + '-' + baseDir;

        // Create a languageService/host for each asset if it doesn't already exist.
        if (tsconfig && !langServiceCache[configHash]) {
          // In order to prevent race conditions where we accidentally create two language services for the same config,
          // it's important that nothing in this block is asynchronous.
          let configHost = new ParseConfigHost(options.inputFS, ts);
          let parsedCommandLine = ts.parseJsonConfigFileContent(
            tsconfig,
            configHost,
            baseDir,
          );
          const host = new LanguageServiceHost(
            options.inputFS,
            ts,
            parsedCommandLine,
          );
          langServiceCache[configHash] = {
            configHost,
            host,
            service: ts.createLanguageService(
              host,
              ts.createDocumentRegistry(),
            ),
          };
        }

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

      // ANDREW_TODO: should we also call getSemanticDiagnostics and getCompilerOptionsDiagnostics?
      // ANDREW_TODO: this will still not catch errors in dependencies of the files that changed.
      const diagnostics = langServiceCache[
        configHash
      ].service.getSemanticDiagnostics(asset.filePath);

      let validatorResult = {
        warnings: [],
        errors: [],
      };

      // ANDREW_TODO: refactor this into its own function?
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
              let lineChar = file.getLineAndCharacterOfPosition(
                diagnostic.start,
              );
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

      validatorResults.push(validatorResult);
    });

    return validatorResults;
  },
});

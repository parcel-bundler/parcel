// @flow
import type {DiagnosticCodeFrame} from '@parcel/diagnostic';

import path from 'path';
import {md5FromObject} from '@parcel/utils';
import {Validator} from '@parcel/plugin';
import {LanguageServiceHost, ParseConfigHost} from '@parcel/ts-utils';

let langServiceCache: {
  [configHash: string]: {|host: LanguageServiceHost, service: any|},
  ...,
} = {};

type TSValidatorConfig = {|
  filepath: string | null,
  baseDir: string,
  configHash: string,
  tsconfig: any,
|};

export default new Validator({
  async getConfig({
    asset,
    options,
    resolveConfig,
  }): Promise<?TSValidatorConfig> {
    let configNames = ['tsconfig.json'];
    let tsconfig = await asset.getConfig(configNames);
    let configPath: string | null = await resolveConfig(configNames);
    let baseDir = configPath ? path.dirname(configPath) : options.projectRoot;
    let configHash = (tsconfig ? md5FromObject(tsconfig) : '') + '-' + baseDir;

    return {
      filepath: configPath,
      baseDir,
      configHash,
      tsconfig,
    };
  },

  async validate({asset, config, options}) {
    let ts = await options.packageManager.require('typescript', asset.filePath);

    // This should never happen...
    if (!config) return;

    let {baseDir, configHash, tsconfig} = config;
    if (tsconfig && !langServiceCache[configHash]) {
      let parsedCommandLine = ts.parseJsonConfigFileContent(
        tsconfig,
        new ParseConfigHost(options.inputFS, ts),
        baseDir,
      );
      const host = new LanguageServiceHost(
        options.inputFS,
        ts,
        parsedCommandLine,
      );
      langServiceCache[configHash] = {
        host,
        service: ts.createLanguageService(host, ts.createDocumentRegistry()),
      };
    }

    if (!langServiceCache[configHash]) return;

    // Make sure that when the typescript language service asks us for this file, we let it know that there is a new version.
    langServiceCache[configHash].host.invalidate(asset.filePath);

    const diagnostics = langServiceCache[
      configHash
    ].service.getSemanticDiagnostics(asset.filePath);

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
  },
});

// @flow
import {Validator} from '@parcel/plugin';
import logger from '@parcel/logger';
import type {DiagnosticCodeFrame} from '@parcel/diagnostic';

let cliEngine = null;

export default new Validator({
  async validate({asset, options}) {
    let eslint = await options.packageManager.require('eslint', asset.filePath);
    if (!cliEngine) {
      cliEngine = new eslint.CLIEngine({});
    }
    let code = await asset.getCode();
    let report = cliEngine.executeOnText(code, asset.filePath);

    if (report.results.length > 0) {
      for (let result of report.results) {
        let codeframe: DiagnosticCodeFrame = {
          code: result.source,
          codeHighlights: result.messages.map(message => {
            return {
              start: {
                line: message.line,
                column: message.column
              },
              end: {
                line: message.endLine,
                column: message.endColumn
              },
              message: message.message
            };
          })
        };

        logger.error({
          origin: '@parcel/validator-eslint',
          message: `ESLint found ${result.errorCount} errors and ${
            result.warningCount
          } warnings.`,
          filename: asset.filePath,
          codeframe: codeframe,
          hints: result.messages
            .map(message => {
              return message.fix && `${message.message}: ${message.fix.text}`;
            })
            .filter(m => !!m)
        });
      }
    }
  }
});

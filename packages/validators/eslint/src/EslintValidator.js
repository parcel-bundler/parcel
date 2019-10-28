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

    let errorCount = 0;
    if (report.results.length > 0) {
      for (let result of report.results) {
        if (!result.errorCount && !result.warningCount) continue;

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

        let diagnostic = {
          origin: '@parcel/validator-eslint',
          message: `ESLint found **${result.errorCount}** __errors__ and **${
            result.warningCount
          }** __warnings__.`,
          filename: asset.filePath,
          codeframe: codeframe
        };

        if (result.errorCount > 0) {
          logger.error(diagnostic);
          errorCount += result.errorCount;
        } else {
          logger.warn(diagnostic);
        }
      }
    }

    if (errorCount) {
      throw new Error(`ESLint found ${errorCount} error(s)!`);
    }
  }
});

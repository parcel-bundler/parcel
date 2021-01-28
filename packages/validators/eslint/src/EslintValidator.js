// @flow
import {Validator} from '@parcel/plugin';
import type {DiagnosticCodeFrame} from '@parcel/diagnostic';

let cliEngine = null;

export default (new Validator({
  async validate({asset, options}) {
    let eslint = await options.packageManager.require(
      'eslint',
      asset.filePath,
      {shouldAutoInstall: options.shouldAutoInstall},
    );
    if (!cliEngine) {
      cliEngine = new eslint.CLIEngine({});
    }
    let code = await asset.getCode();
    let report = cliEngine.executeOnText(code, asset.filePath);

    let validatorResult = {
      warnings: [],
      errors: [],
    };

    if (report.results.length > 0) {
      for (let result of report.results) {
        if (!result.errorCount && !result.warningCount) continue;

        let codeframe: DiagnosticCodeFrame = {
          code: result.source,
          codeHighlights: result.messages.map(message => {
            let start = {
              line: message.line,
              column: message.column,
            };
            return {
              start,
              // Parse errors have no ending
              end:
                message.endLine != null
                  ? {
                      line: message.endLine,
                      column: message.endColumn,
                    }
                  : start,
              message: message.message,
            };
          }),
        };

        let diagnostic = {
          origin: '@parcel/validator-eslint',
          message: `ESLint found **${result.errorCount}** __errors__ and **${result.warningCount}** __warnings__.`,
          filePath: asset.filePath,
          codeFrame: codeframe,
        };

        if (result.errorCount > 0) {
          validatorResult.errors.push(diagnostic);
        } else {
          validatorResult.warnings.push(diagnostic);
        }
      }
    }

    return validatorResult;
  },
}): Validator);

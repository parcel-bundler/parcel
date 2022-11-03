// @flow
import {Validator} from '@parcel/plugin';
import {type DiagnosticCodeFrame, escapeMarkdown} from '@parcel/diagnostic';
import eslint from 'eslint';
import invariant from 'assert';

let cliEngine = null;

export default (new Validator({
  async validate({asset}) {
    if (!cliEngine) {
      cliEngine = new eslint.CLIEngine({});
    }
    let code = await asset.getCode();

    invariant(cliEngine != null);
    let report = cliEngine.executeOnText(code, asset.filePath);

    let validatorResult = {
      warnings: [],
      errors: [],
    };

    if (report.results.length > 0) {
      for (let result of report.results) {
        if (!result.errorCount && !result.warningCount) continue;

        let codeframe: DiagnosticCodeFrame = {
          filePath: asset.filePath,
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
              message: escapeMarkdown(message.message),
            };
          }),
        };

        let diagnostic = {
          origin: '@parcel/validator-eslint',
          message: `ESLint found **${result.errorCount}** __errors__ and **${result.warningCount}** __warnings__.`,
          codeFrames: [codeframe],
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

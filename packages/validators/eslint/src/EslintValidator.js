// @flow
import {Validator} from '@parcel/plugin';
import {type DiagnosticCodeFrame, escapeMarkdown} from '@parcel/diagnostic';
import eslint from 'eslint';
import invariant from 'assert';

let eslintInstance = null;

export default (new Validator({
  async validate({asset}) {
    const isPostV8 = typeof eslint.ESLint !== 'undefined';

    if (!eslintInstance) {
      eslintInstance = isPostV8 ? new eslint.ESLint() : new eslint.CLIEngine();
    }

    invariant(eslint != null);

    const code = await asset.getCode();
    const report = isPostV8
      ? eslintInstance.lintText(code, {filePath: asset.filePath})
      : eslintInstance.executeOnText(code, asset.filePath);

    const validatorResult = {
      warnings: [],
      errors: [],
    };

    if (report.results.length > 0) {
      for (const result of report.results) {
        if (!result.errorCount && !result.warningCount) continue;

        const codeframe: DiagnosticCodeFrame = {
          filePath: asset.filePath,
          code: result.source,
          codeHighlights: result.messages.map(message => {
            const start = {
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

        const diagnostic = {
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

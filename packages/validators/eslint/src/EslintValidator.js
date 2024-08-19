// @flow
import {Validator} from '@atlaspack/plugin';
import {type DiagnosticCodeFrame, escapeMarkdown} from '@atlaspack/diagnostic';
import eslint from 'eslint';
import invariant from 'assert';

// For eslint <8.0.0
let cliEngine = null;
// For eslint >=8.0.0
let eslintEngine = null;

export default (new Validator({
  async validate({asset}) {
    if (!cliEngine && !eslintEngine) {
      if (eslint.ESLint) {
        eslintEngine = new eslint.ESLint({});
      } else {
        cliEngine = new eslint.CLIEngine({});
      }
    }
    let code = await asset.getCode();

    let results;
    if (cliEngine != null) {
      results = cliEngine.executeOnText(code, asset.filePath).results;
    } else if (eslintEngine != null) {
      results = await eslintEngine.lintText(code, {filePath: asset.filePath});
    } else {
      invariant(false);
    }

    let validatorResult = {
      warnings: [],
      errors: [],
    };

    for (let result of results) {
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
                    column: message.endColumn - 1,
                  }
                : start,
            message: escapeMarkdown(message.message),
          };
        }),
      };

      let diagnostic = {
        origin: '@atlaspack/validator-eslint',
        message: `ESLint found **${result.errorCount}** __errors__ and **${result.warningCount}** __warnings__.`,
        codeFrames: [codeframe],
      };

      if (result.errorCount > 0) {
        validatorResult.errors.push(diagnostic);
      } else {
        validatorResult.warnings.push(diagnostic);
      }
    }

    return validatorResult;
  },
}): Validator);

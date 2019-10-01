// @flow
import {Validator} from '@parcel/plugin';
import path from 'path';

type CodeFrameError = Error & {codeFrame?: string, ...};

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
      let formatter = cliEngine.getFormatter('codeframe');

      let err: CodeFrameError = new Error(
        `ESLint issues found in ${path.relative(
          options.projectRoot,
          asset.filePath
        )}`
      );
      err.codeFrame = formatter(report.results);

      throw err;
    }
  }
});

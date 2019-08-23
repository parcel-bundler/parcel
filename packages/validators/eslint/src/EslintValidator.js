// @flow
import {Validator} from '@parcel/plugin';

export default new Validator({
  async validate({asset, localRequire}) {
    let eslint = await localRequire('eslint', asset.filePath);
    let CLIEngine = eslint.CLIEngine;

    let cliEngine = new CLIEngine({});
    let report = cliEngine.executeOnFiles([asset.filePath]);

    console.log(report);
  }
});

// @flow

import {Transformer} from '@parcel/plugin';

export default new Transformer({
  async transform({asset, options}) {
    asset.type = 'js';
    const bsb = await options.packageManager.require('bsb-js', asset.filePath);

    // This runs BuckleScript - the Reason to JS compiler.
    // Other Asset types use `localRequire` but the `bsb-js` package already
    // does that internally. This should also take care of error handling in
    // the Reason compilation process.
    if (process.env.NODE_ENV !== 'test') {
      await bsb.runBuild();
    }

    // This is a simplified use-case for Reason - it only loads the recommended
    // BuckleScript configuration to simplify the file processing.
    const outputFile = asset.filePath.replace(/\.(re|ml)$/, '.bs.js');
    const code = await asset.fs.readFile(outputFile);
    asset.setCode(code.toString());

    return [asset];
  }
});

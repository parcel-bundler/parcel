// @flow

import nullthrows from 'nullthrows';
import {minify} from 'terser';
import {Optimizer} from '@parcel/plugin';
import {loadConfig} from '@parcel/utils';

export default new Optimizer({
  async optimize({contents, bundle, options}) {
    if (!options.minify) {
      return contents;
    }

    if (typeof contents !== 'string') {
      throw new Error(
        'TerserOptimizer: Only string contents are currently supported'
      );
    }

    let userConfig = await loadConfig(bundle.filePath, [
      '.terserrc',
      '.uglifyrc',
      '.uglifyrc.js',
      '.terserrc.js'
    ]);

    let config = userConfig?.config ?? {
      warnings: true
    };

    // $FlowFixMe
    let result = minify(contents, config);

    if (result.error) {
      throw result.error;
    }

    return nullthrows(result.code);
  }
});

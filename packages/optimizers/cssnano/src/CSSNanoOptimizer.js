// @flow strict-local

import {Optimizer} from '@parcel/plugin';
// $FlowFixMe this is untyped
import postcss from 'postcss';
// $FlowFixMe this is untyped
import cssnano from 'cssnano';

export default new Optimizer({
  async optimize({contents, options}) {
    if (!options.minify) {
      return contents;
    }

    if (typeof contents.code !== 'string') {
      throw new Error(
        'CSSNanoOptimizer: Only string contents are currently supported'
      );
    }

    return {
      code: (await postcss([cssnano]).process(contents.code)).css
    };
  }
});

// @flow strict-local

import {Optimizer} from '@parcel/plugin';
// $FlowFixMe this is untyped
import postcss from 'postcss';
// $FlowFixMe this is untyped
import cssnano from 'cssnano';

export default new Optimizer({
  async optimize({bundle, contents, map}) {
    if (!bundle.env.minify) {
      return {contents, map};
    }

    if (typeof contents !== 'string') {
      throw new Error(
        'CSSNanoOptimizer: Only string contents are currently supported',
      );
    }

    return {
      contents: (await postcss([cssnano]).process(contents)).css,
    };
  },
});

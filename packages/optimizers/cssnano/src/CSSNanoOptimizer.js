// @flow strict-local

import {Optimizer} from '@parcel/plugin';
import postcss from 'postcss';
// flowlint-next-line untyped-import:off
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

    const results = await postcss([cssnano]).process(contents, {
      from: bundle.filePath,
      map: {inline: false},
    });

    console.log('MAP', results.map.constructor);

    return {
      contents: results.css,
      map: results.map,
    };
  },
});

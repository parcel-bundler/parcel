// @flow strict-local

// flowlint-next-line untyped-import:off
import htmlnano from 'htmlnano';
import {loadConfig} from '@parcel/utils';
import {Optimizer} from '@parcel/plugin';
import posthtml from 'posthtml';
import path from 'path';

export default new Optimizer({
  async optimize({bundle, contents, map, options}) {
    if (!bundle.env.minify) {
      return {contents, map};
    }

    if (typeof contents !== 'string') {
      throw new Error(
        'HTMLNanoOptimizer: Only string contents are currently supported',
      );
    }

    let userConfig = await loadConfig(
      options.inputFS,
      path.join(options.rootDir, 'index.html'),
      ['.htmlnanorc', '.htmlnanorc.js'],
    );

    const htmlNanoConfig = {
      minifyJs: false,
      ...userConfig?.config,
    };

    return {
      contents: (await posthtml([htmlnano(htmlNanoConfig)]).process(contents))
        .html,
    };
  },
});

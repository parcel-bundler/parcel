// @flow strict-local

import htmlnano from 'htmlnano';
import {Optimizer} from '@parcel/plugin';
import posthtml from 'posthtml';
import path from 'path';

export default (new Optimizer({
  async loadConfig({config, options}) {
    let userConfig = await config.getConfigFrom(
      path.join(options.entryRoot, 'index.html'),
      ['.htmlnanorc', '.htmlnanorc.js'],
    );

    if (userConfig) {
      let isJavascript = path.extname(userConfig.filePath) === '.js';
      if (isJavascript) {
        config.invalidateOnStartup();
      }
    }

    return userConfig?.contents;
  },
  async optimize({bundle, contents, map, config}) {
    if (!bundle.env.shouldOptimize) {
      return {contents, map};
    }

    if (typeof contents !== 'string') {
      throw new Error(
        'HTMLNanoOptimizer: Only string contents are currently supported',
      );
    }

    const htmlNanoConfig = {
      minifyJs: false,
      ...config,
    };

    return {
      contents: (await posthtml([htmlnano(htmlNanoConfig)]).process(contents))
        .html,
    };
  },
}): Optimizer);

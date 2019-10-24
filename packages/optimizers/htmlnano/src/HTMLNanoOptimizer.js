// @flow strict-local

// $FlowFixMe this is untyped
import htmlnano from 'htmlnano';
import nullthrows from 'nullthrows';
import {loadConfig} from '@parcel/utils';
import {Optimizer} from '@parcel/plugin';
import posthtml from 'posthtml';

export default new Optimizer({
  async optimize({contents, bundle, map, options}) {
    if (!options.minify) {
      return {contents, map};
    }

    if (typeof contents !== 'string') {
      throw new Error(
        'HTMLNanoOptimizer: Only string contents are currently supported'
      );
    }

    let userConfig = await loadConfig(
      options.inputFS,
      nullthrows(bundle.getMainEntry()).filePath,
      ['.htmlnanorc', '.htmlnanorc.js']
    );

    const htmlNanoConfig = {
      minifyJs: false,
      ...userConfig?.config
    };

    return {
      contents: (await posthtml([htmlnano(htmlNanoConfig)]).process(contents))
        .html
    };
  }
});

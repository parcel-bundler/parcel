// @flow strict-local

import {Optimizer} from '@atlaspack/plugin';
import {blobToString} from '@atlaspack/utils';

export default (new Optimizer({
  async optimize({contents}) {
    // Inspired by webpack's worker plugin:
    // https://github.com/webpack-contrib/worker-loader/blob/b82585a1ddb8ae295fd4b1c302bca6b162665de2/src/workers/InlineWorker.js
    // which itself draws from:
    // http://stackoverflow.com/questions/10343913/how-to-create-a-web-worker-from-a-string
    //
    // This version only uses the Blob constructor, which is available in IE 10+:
    // https://developer.mozilla.org/en-US/docs/Web/API/Blob
    return {
      contents: `URL.createObjectURL(new Blob([${JSON.stringify(
        await blobToString(contents),
      )}]))`,
    };
  },
}): Optimizer);

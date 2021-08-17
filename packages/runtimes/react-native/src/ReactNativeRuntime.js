// @flow strict-local

import path from 'path';
import {Runtime} from '@parcel/plugin';

const CODE = `
import '@react-native/polyfills/console.js';
import '@react-native/polyfills/error-guard.js';
import '@react-native/polyfills/Object.es8.js';
import 'react-native/Libraries/Core/InitializeCore.js';
`;

export default (new Runtime({
  apply({bundle, options}) {
    if (bundle.type !== 'js') {
      return;
    }

    // TODO not in every bundle
    return {
      filePath: path.join(options.projectRoot, 'index'),
      code: CODE,
      isEntry: true,
    };
  },
}): Runtime);

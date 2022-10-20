// @flow strict-local

import path from 'path';
import {Runtime} from '@parcel/plugin';

const CODE = `
import '@react-native/polyfills/console.js';
import '@react-native/polyfills/error-guard.js';
import '@react-native/polyfills/Object.es8.js';
import 'react-native/Libraries/Core/InitializeCore.js';

import {DevSettings} from 'react-native';
global.PARCEL_DevSettings = DevSettings;
const getDevServer = require("react-native/Libraries/Core/Devtools/getDevServer");
global.PARCEL_getDevServer = getDevServer;
`;

export default (new Runtime({
  apply({bundle, options}) {
    if (bundle.type !== 'js' || !bundle.env.isReactNative()) {
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

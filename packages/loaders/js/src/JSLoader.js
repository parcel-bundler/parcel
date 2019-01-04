// @flow
import {Loader} from '@parcel/plugin';

export default new Loader({
  generate(bundle) {
    // if (bundle.env.isNode()) {
    //   return {filePath: require.resolve('./node')};
    // } else if (bundle.env.isBrowser()) {
      return {filePath: require.resolve('./browser')};
    // }

    throw new Error(`Unknown environment for JS loader: ${bundle.env.context}`);
  }
});

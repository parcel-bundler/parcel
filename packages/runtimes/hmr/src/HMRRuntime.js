// @flow

import type {BundleGroupNode} from '@parcel/types';

import {Runtime} from '@parcel/plugin';
import {readFile} from '@parcel/fs';
import path from 'path';

const HMR_RUNTIME = './loaders/hmr-runtime.js';

let hmrRuntimeCode = null;
export default new Runtime({
  async apply(bundle, options) {
    if (bundle.type !== 'js' || !options.hot) {
      return;
    }

    // TODO: Figure out how to get the port & hostname to the global config of Parcel
    // Perhaps parcel core should be responsible of assigning ports to the server and HMR?
    if (typeof options.hot !== 'object') {
      return;
    }

    if (!hmrRuntimeCode) {
      hmrRuntimeCode = await readFile(path.join(__dirname, HMR_RUNTIME));
    }

    // $FlowFixMe Flow can't refine on filter https://github.com/facebook/flow/issues/1414
    let bundleGroups: Array<BundleGroupNode> = Array.from(
      bundle.assetGraph.nodes.values()
    ).filter(n => n.type === 'bundle_group');

    for (let bundleGroup of bundleGroups) {
      // Ignore deps with native loaders, e.g. workers.
      if (bundleGroup.value.dependency.isURL) {
        continue;
      }

      if (typeof options.hot !== 'object') return;

      // TODO: Inject these as environment variables
      // let HMR_HOSTNAME = options.hot.host;
      // let HMR_PORT = options.hot.port;

      // $FlowFixMe
      await bundle.assetGraph.addRuntimeAsset(bundleGroup, {
        filePath: __filename,
        env: bundle.env,
        code: hmrRuntimeCode
      });
    }
  }
});

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
      throw new Error(
        'options.hot should be an object, otherwise the HMR Runtime has no clue what port to use'
      );
    }

    if (!hmrRuntimeCode) {
      hmrRuntimeCode = (await readFile(
        path.join(__dirname, HMR_RUNTIME)
      )).toString('utf8');
    }

    // TODO: Get rid of this hacky stuff
    let root = Array.from(bundle.assetGraph.nodes.values()).find(
      asset => asset.type === 'root'
    );

    if (!root || !options.hot) return;

    let HMR_HOSTNAME = `"${options.hot.host || 'localhost'}"`;
    let HMR_PORT = `"${(options.hot.port || 12345).toString()}"`;

    // TODO: Get rid of this hacky stuff
    // $FlowFixMe
    await bundle.assetGraph.addRuntimeAsset(root, {
      filePath: __filename,
      env: bundle.env,
      code: hmrRuntimeCode
        // TODO: Inject host & port as environment variables
        // TODO: So it can be invalidated
        .replace(/process.env.HMR_HOSTNAME/g, HMR_HOSTNAME)
        .replace(/process.env.HMR_PORT/g, HMR_PORT)
    });
  }
});

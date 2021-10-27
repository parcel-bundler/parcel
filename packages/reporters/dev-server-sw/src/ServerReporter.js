// @flow
import {Reporter} from '@parcel/plugin';
import HMRServer, {getHotAssetContents} from './HMRServer';

let hmrServer;
let hmrAssetSourceCleanup: (() => void) | void;

export default (new Reporter({
  async report({event, options}) {
    let {hmrOptions} = options;
    switch (event.type) {
      case 'watchStart': {
        if (hmrOptions) {
          hmrServer = new HMRServer(data =>
            // $FlowFixMe
            globalThis.PARCEL_SERVICE_WORKER('hmrUpdate', data),
          );
        }
        break;
      }
      case 'watchEnd':
        break;
      case 'buildStart':
        break;
      case 'buildSuccess':
        {
          let files: {|[string]: string|} = {};
          for (let f of await options.outputFS.readdir('/app/dist')) {
            files[f] = await options.outputFS.readFile(
              '/app/dist/' + f,
              'utf8',
            );
          }
          // $FlowFixMe
          await globalThis.PARCEL_SERVICE_WORKER('setFS', files);

          hmrAssetSourceCleanup?.();
          // $FlowFixMe
          hmrAssetSourceCleanup = globalThis.PARCEL_SERVICE_WORKER_REGISTER(
            'hmrAssetSource',
            async id => {
              let bundleGraph = event.bundleGraph;
              let asset = bundleGraph.getAssetById(id);
              return [
                asset.type,
                await getHotAssetContents(bundleGraph, asset),
              ];
            },
          );

          if (hmrServer) {
            await hmrServer?.emitUpdate(event);
          }
        }
        break;
      case 'buildFailure':
        await hmrServer?.emitError(options, event.diagnostics);
        break;
    }
  },
}): Reporter);

// @flow

import {Reporter} from '@parcel/plugin';
import invariant from 'assert';
import Server from './Server';
import HMRServer from './HMRServer';
import path from 'path';

let servers: Map<number, Server> = new Map();
let hmrServers: Map<number, HMRServer> = new Map();
export default new Reporter({
  async report({event, options, logger}) {
    let serve = options.serve;
    if (!serve) return;

    let server = servers.get(serve.port);
    let hmrServer = hmrServers.get(serve.port);
    switch (event.type) {
      case 'watchStart': {
        // If there's already a server when watching has just started, something
        // is wrong.
        invariant(server == null);

        let serverOptions = {
          ...serve,
          projectRoot: options.projectRoot,
          cacheDir: options.cacheDir,
          distDir: path.join(options.cacheDir, 'dist'),
          // Override the target's publicUrl as that is likely meant for production.
          // This could be configurable in the future.
          publicUrl: serve.publicUrl ?? '/',
          inputFS: options.inputFS,
          outputFS: options.outputFS,
          logger,
        };

        server = new Server(serverOptions);
        servers.set(serve.port, server);
        const devServer = await server.start();

        if (options.hot) {
          let hmrServerOptions = {
            devServer,
            logger,
          };
          const hmrServer = new HMRServer(hmrServerOptions);
          hmrServers.set(serve.port, hmrServer);
          hmrServer.start();
        }

        break;
      }
      case 'watchEnd':
        invariant(server != null);
        if (hmrServer) {
          hmrServer.stop();
        }
        await server.stop();
        servers.delete(serve.port);
        hmrServers.delete(serve.port);
        break;
      case 'buildSuccess':
        invariant(server != null);
        server.buildSuccess(event.bundleGraph);
        if (hmrServer) {
          hmrServer.emitUpdate(event);
        }
        break;
      case 'buildFailure':
        invariant(server != null);
        server.buildError(event.diagnostics);
        if (hmrServer) {
          hmrServer.emitError(event.diagnostics);
        }
        break;
    }
  },
});

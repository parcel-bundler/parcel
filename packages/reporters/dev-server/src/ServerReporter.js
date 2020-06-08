// @flow

import {Reporter} from '@parcel/plugin';
import HMRServer from './HMRServer';
import Server from './Server';

let servers: Map<number, Server> = new Map();
let hmrServers: Map<number, HMRServer> = new Map();
export default new Reporter({
  async report({event, options, logger}) {
    let {serve, hot: hmr} = options;
    let server = serve ? servers.get(serve.port) : undefined;
    let hmrPort = (hmr && hmr.port) || (serve && serve.port);
    let hmrServer = hmrPort ? hmrServers.get(hmrPort) : undefined;
    switch (event.type) {
      case 'watchStart': {
        if (serve) {
          // If there's already a server when watching has just started, something
          // is wrong.
          if (server) {
            return logger.warn({
              message: 'Trying to create the devserver but it already exists.',
            });
          }

          let serverOptions = {
            ...serve,
            projectRoot: options.projectRoot,
            cacheDir: options.cacheDir,
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

          if (hmr && (hmr.port === serve.port || hmr === true)) {
            let hmrServerOptions = {
              port: serve.port,
              devServer,
              logger,
            };
            hmrServer = new HMRServer(hmrServerOptions);
            hmrServers.set(serve.port, hmrServer);
            hmrServer.start();
            return;
          }
        }

        if (hmr && typeof hmr.port === 'number') {
          let hmrServerOptions = {
            port: hmr.port,
            logger,
          };
          hmrServer = new HMRServer(hmrServerOptions);
          hmrServers.set(hmr.port, hmrServer);
          hmrServer.start();
        }
        break;
      }
      case 'watchEnd':
        if (serve) {
          if (!server) {
            return logger.warn({
              message:
                'Could not shutdown devserver because it does not exist.',
            });
          }
          await server.stop();
          servers.delete(server.options.port);
        }
        if (hmr && hmrServer) {
          hmrServer.stop();
          hmrServers.delete(hmrServer.wss.options.port);
        }
        break;
      case 'buildStart':
        if (server) {
          server.buildStart();
        }
        break;
      case 'buildSuccess':
        if (serve) {
          if (!server) {
            return logger.warn({
              message:
                'Could not send success event to devserver because it does not exist.',
            });
          }

          server.buildSuccess(event.bundleGraph);
        }
        if (hmrServer) {
          hmrServer.emitUpdate(event);
        }
        break;
      case 'buildFailure':
        // On buildFailure watchStart sometimes has not been called yet
        // do not throw an additional warning here
        if (server) {
          await server.buildError(options, event.diagnostics);
        }
        if (hmrServer) {
          await hmrServer.emitError(options, event.diagnostics);
        }
        break;
    }
  },
});

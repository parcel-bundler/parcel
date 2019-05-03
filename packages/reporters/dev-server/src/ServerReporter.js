// @flow
import {Reporter} from '@parcel/plugin';
import Server from './Server';

let servers: Map<number, Server> = new Map();
export default new Reporter({
  async report(event, options) {
    let serve = options.serve;
    if (!serve) return;

    let isBrowser = options.targets.some(
      target => target.env.context === 'browser'
    );
    if (!isBrowser) return;

    let serverOptions = {
      ...serve,
      cacheDir: options.cacheDir,
      distDir: 'dist', //options.distDir, // ! Not sure how this works now
      // $FlowFixMe
      publicUrl: options.publicUrl || '/'
    };

    let server = servers.get(serverOptions.port);
    if (!server) {
      server = new Server(serverOptions);
      servers.set(serverOptions.port, server);
      await server.start();
    }

    if (event.type === 'buildSuccess') {
      server.buildSuccess(event.bundleGraph);
    }

    if (event.type === 'buildFailure') {
      server.buildError(event.error);
    }
  }
});

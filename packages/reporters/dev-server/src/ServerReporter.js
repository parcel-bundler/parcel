// @flow
import {Reporter} from '@parcel/plugin';
import Server from './Server';

let server: Server | null = null;
export default new Reporter({
  async report(event, options) {
    if (!options.serve || !options.cacheDir) return;

    if (!server) {
      let serverOptions = {
        host: options.serve.host,
        port: options.serve.port,
        https: options.serve.https,
        cacheDir: options.cacheDir,
        distDir: 'dist', //options.distDir, // ! Not sure how this works now
        publicUrl: options.publicUrl || '/'
      };

      server = new Server(serverOptions);
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

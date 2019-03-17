// @flow
import type {ServerOptions} from '@parcel/types';
import type {PrintableError} from '@parcel/logger/src/prettyError';
import type {Server} from './types.js.flow';
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import generateCertificate from './generateCertificate';
import getCertificate from './getCertificate';
import logger from '@parcel/logger';

type HMROptions = ServerOptions;
type SocketError = Error & {
  code?: string
};

type HMRMessage = {|
  type: string,
  error?: {
    message: string,
    stack?: string
  },
  // TODO: Update assets type once it actually works
  assets?: Array<any>
|};

export default class HMRServer {
  server: Server;
  wss: WebSocket.Server;
  unresolvedError: HMRMessage | null = null;

  async start(
    options: HMROptions = {
      port: 0
    }
  ) {
    await new Promise(async resolve => {
      if (!options.https) {
        this.server = http.createServer();
      } else if (typeof options.https === 'boolean') {
        this.server = https.createServer(generateCertificate(options));
      } else {
        this.server = https.createServer(await getCertificate(options.https));
      }

      let websocketOptions = {
        server: this.server,
        origin: options.host
          ? `${options.https ? 'https' : 'http'}://${options.host}`
          : undefined
      };

      this.wss = new WebSocket.Server(websocketOptions);
      this.server.listen(options.port, resolve);
    });

    this.wss.on('connection', ws => {
      ws.onerror = this.handleSocketError;

      if (this.unresolvedError) {
        ws.send(JSON.stringify(this.unresolvedError));
      }
    });

    this.wss.on('error', this.handleSocketError);

    return this.wss._server.address().port;
  }

  stop() {
    this.wss.close();
    this.server.close();
  }

  emitError(err: PrintableError) {
    let {message, stack} = logger.formatError(err);

    // store the most recent error so we can notify new connections
    // and so we can broadcast when the error is resolved
    this.unresolvedError = {
      type: 'error',
      error: {
        message,
        stack
      }
    };

    this.broadcast(this.unresolvedError);
  }

  emitUpdate(assets: Array<Object>, reload: boolean = false) {
    if (this.unresolvedError) {
      this.unresolvedError = null;
      this.broadcast({
        type: 'error-resolved'
      });
    }

    const shouldReload = reload || assets.some(asset => asset.hmrPageReload);
    if (shouldReload) {
      this.broadcast({
        type: 'reload'
      });
    } else {
      this.broadcast({
        type: 'update',
        assets: assets.map(asset => {
          let deps = {};
          for (let [dep, depAsset] of asset.depAssets) {
            deps[dep.name] = depAsset.id;
          }

          return {
            id: asset.id,
            type: asset.type,
            generated: asset.generated,
            deps: deps
          };
        })
      });
    }
  }

  handleSocketError(err: SocketError) {
    if (err.code === 'ECONNRESET') {
      // This gets triggered on page refresh, ignore this
      return;
    }

    logger.warn(err);
  }

  broadcast(msg: HMRMessage) {
    const json = JSON.stringify(msg);
    for (let ws of this.wss.clients) {
      ws.send(json);
    }
  }
}

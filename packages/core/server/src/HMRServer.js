const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const generateCertificate = require('./utils/generateCertificate');
const getCertificate = require('./utils/getCertificate');
const logger = require('@parcel/logger');

class HMRServer {
  constructor(cliOpts) {
    this.updatedAssets = [];
    this.options = cliOpts;
  }

  async start() {
    await new Promise(async resolve => {
      if (!this.options.https) {
        this.server = http.createServer();
      } else if (typeof this.options.https === 'boolean') {
        this.server = https.createServer(generateCertificate(this.options));
      } else {
        this.server = https.createServer(
          await getCertificate(this.options.https)
        );
      }

      let websocketOptions = {
        server: this.server
      };

      if (this.options.hmrHostname) {
        websocketOptions.origin = `${this.options.https ? 'https' : 'http'}://${
          this.options.hmrHostname
        }`;
      }

      this.wss = new WebSocket.Server(websocketOptions);
      this.server.listen(this.options.hmrPort, resolve);
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

  updateAsset(asset) {
    console.log(asset);
    this.updatedAssets.push(asset);
  }

  emitError(err) {
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

  emitUpdate() {
    if (this.unresolvedError) {
      this.unresolvedError = null;
      this.broadcast({
        type: 'error-resolved'
      });
    }

    let assets = this.updatedAssets;
    let shouldReload = assets.some(asset => asset.hmrPageReload);
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
            generated: asset.generated,
            deps: deps
          };
        })
      });
    }

    this.updatedAssets = [];
  }

  handleSocketError(err) {
    if (err.error.code === 'ECONNRESET') {
      // This gets triggered on page refresh, ignore this
      return;
    }
    logger.warn(err);
  }

  broadcast(msg) {
    const json = JSON.stringify(msg);
    for (let ws of this.wss.clients) {
      ws.send(json);
    }
  }
}

module.exports = HMRServer;

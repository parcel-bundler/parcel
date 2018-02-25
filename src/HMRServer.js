const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const prettyError = require('./utils/prettyError');
const generateCertificate = require('./utils/generateCertificate');
const logger = require('./Logger');

class HMRServer {
  async start(options = {}) {
    await new Promise(resolve => {
      let server = options.https
        ? https.createServer(generateCertificate(options))
        : http.createServer();

      this.wss = new WebSocket.Server({server});
      server.listen(options.hmrPort, resolve);
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
  }

  emitError(err) {
    let {message, stack} = prettyError(err);

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

  emitUpdate(assets) {
    if (this.unresolvedError) {
      this.unresolvedError = null;
      this.broadcast({
        type: 'error-resolved'
      });
    }

    const containsHtmlAsset = assets.some(asset => asset.type === 'html');
    if (containsHtmlAsset) {
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

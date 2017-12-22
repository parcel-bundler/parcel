const WebSocket = require('ws');
const prettyError = require('./utils/prettyError');

class HMRServer {
  async start() {
    await new Promise(resolve => {
      this.wss = new WebSocket.Server({port: 0}, resolve);
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
          for (let dep of asset.dependencies.values()) {
            let mod = asset.depAssets.get(dep.name);
            deps[dep.name] = mod.id;
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
    if (err.code === 'ECONNRESET') {
      // This gets triggered on page refresh, ignore this
      return;
    }
    // TODO: Use logger to print errors
    console.log(prettyError(err));
  }

  broadcast(msg) {
    const json = JSON.stringify(msg);
    for (let ws of this.wss.clients) {
      ws.send(json);
    }
  }
}

module.exports = HMRServer;

const WebSocket = require('ws');
const prettyError = require('./utils/prettyError');

class HMRServer {
  async start() {
    await new Promise((resolve) => {
      this.wss = new WebSocket.Server({port: 0}, resolve);
    });

    this.wss.on('connection', (ws) => {
      if (this.unresolvedError) {
        ws.send(JSON.stringify(this.unresolvedError))
      }
    });

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

    this.broadcast(this.unresolvedError)
  }

  emitUpdate(assets) {
    if (this.unresolvedError) {
      this.unresolvedError = null
      this.broadcast({
        type: 'error-resolved'
      });
    }

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

  broadcast(msg) {
    const json = JSON.stringify(msg)
    for (let ws of this.wss.clients) {
      ws.send(json);
    }
  }
}

module.exports = HMRServer;

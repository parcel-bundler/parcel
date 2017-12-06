const WebSocket = require('ws');

class HMRServer {
  async start() {
    await new Promise((resolve) => {
      this.wss = new WebSocket.Server({port: 0}, resolve);
    });

    return this.wss._server.address().port;
  }

  stop() {
    this.wss.close();
  }

  emitUpdate(assets) {
    let msg = JSON.stringify({
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

    for (let ws of this.wss.clients) {
      ws.send(msg);
    }
  }
}

module.exports = HMRServer;

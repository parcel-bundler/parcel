// @flow
'use strict';
const EventEmitter = require('events');

class AbortError extends Error {
  // ...
}

class Orchestrator extends EventEmitter {
  constructor(entries) {
    super();

    this.watcher = new Watcher();
    this.hmrServer = new HmrServer();

    this.entries = entries;

    this.assetGraphBuilder = new AssetGraphBuilder();
    this.bundleBuilder = new BundleBuilder();

    this.assetGraphBuilder.on('complete', (assetGraph) => {
      this.bundleBuilder.build(assetGraph);
    });

  }

  async run({ entries: Array<string>, watch: boolean, serve: boolean }) {
    let controller = new AbortController();
    let signal = controller.signal;

    if (watch) this.watcher.start();
    if (serve) this.server.start();

    this.watcher.on('change', event => {
      this.assetGraphBuilder.emit('change', event);
      controller.abort();
      this.bundle();
    });

    await this.bundle({ signal });

    if (this.watcher.running) {
      await this.watcher.complete();
    }
  }

  async bundle({ signal }) {
    try {
      let assetGraph = await this.assetGraphBuilder.build(..., { signal });
      await this.bundleBuilder.build(assetGraph, { signal });

      signal.addEventLister('abort', () => {
        for (let node of inProgressItems) {
          this.graph.removeNode(node);
        }
      });
    } catch (err) {
      if (!(err instanceof AbortError)) {
        throw err;
      }
    }
  }

  async onChange(event) {
    this.assetGraphBuilder.update(event);
  }
}

module.exports = Orchestrator;

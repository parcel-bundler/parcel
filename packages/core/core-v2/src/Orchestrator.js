// @flow
'use strict';
const EventEmitter = require('events');
const AssetGraphBuilder = require('./AssetGraphBuilder');
// const BundleBuilder = require('./BundleBuilder');

class Orchestrator extends EventEmitter {
  constructor(config, options) {
    super();

    // this.watcher = new Watcher();
    // this.hmrServer = new HmrServer();

    this.assetGraphBuilder = new AssetGraphBuilder(config, options);
    this.bundleBuilder = new BundleBuilder(config, options);

    // this.assetGraphBuilder.on('complete', (assetGraph) => {
    //   this.bundleBuilder.build(assetGraph);
    // });
  }

  async run(cwd, entries) {
    // let controller = new AbortController();
    // let signal = controller.signal;

    // if (watch) this.watcher.start();
    // if (serve) this.server.start();

    // this.watcher.on('change', event => {
    //   this.assetGraphBuilder.emit('change', event);
    //   controller.abort();
    //   this.bundle();
    // });

    await this.bundle(cwd, entries);

    // if (this.watcher.running) {
    //   await this.watcher.complete();
    // }
  }

  async bundle(entries) {
    let assetGraph = await this.assetGraphBuilder.build(entries);
    await this.bundleBuilder.build(assetGraph);
  }

  // async onChange(event) {
  //   this.assetGraphBuilder.update(event);
  // }
}

module.exports = Orchestrator;

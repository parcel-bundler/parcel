// @flow
'use strict';
const EventEmitter = require('events');
const GraphBuilder = require('./GraphBuilder');
// const BundleBuilder = require('./BundleBuilder');

class Orchestrator extends EventEmitter {
  constructor(config, options) {
    super();

    // this.watcher = new Watcher();
    // this.hmrServer = new HmrServer();

    this.graphBuilder = new GraphBuilder(config, options);
    this.bundleBuilder = new BundleBuilder(config, options);

    // this.graphBuilder.on('complete', (graph) => {
    //   this.bundleBuilder.build(graph);
    // });
  }

  async run(cwd, entries) {
    // let controller = new AbortController();
    // let signal = controller.signal;

    // if (watch) this.watcher.start();
    // if (serve) this.server.start();

    // this.watcher.on('change', event => {
    //   this.graphBuilder.emit('change', event);
    //   controller.abort();
    //   this.bundle();
    // });

    await this.bundle(cwd, entries);

    // if (this.watcher.running) {
    //   await this.watcher.complete();
    // }
  }

  async bundle(entries) {
    let graph = await this.graphBuilder.build(entries);
    await this.bundleBuilder.build(graph);
  }

  // async onChange(event) {
  //   this.graphBuilder.update(event);
  // }
}

module.exports = Orchestrator;

// @flow
'use strict';
const EventEmitter = require('events');
const path = require('path');
const GraphBuilder = require('./GraphBuilder');
const BundleBuilder = require('./BundleBuilder');

// TODO: use custom config if present
const config = require('@parcel/config-default');

class Orchestrator extends EventEmitter {
  constructor(entryFiles, options) {
    super();

    this.cwd = process.cwd();
    // this.watcher = new Watcher();
    // this.hmrServer = new HmrServer();

    this.graphBuilder = new GraphBuilder(config, {});
    this.bundleBuilder = new BundleBuilder(config, options);

    // this.graphBuilder.on('complete', (graph) => {
    //   this.bundleBuilder.build(graph);
    // });
  }

  async run(entries) {
    // let controller = new AbortController();
    // let signal = controller.signal;

    // if (watch) this.watcher.start();
    // if (serve) this.server.start();

    // this.watcher.on('change', event => {
    //   this.graphBuilder.emit('change', event);
    //   controller.abort();
    //   this.bundle();
    // });

    await this.bundle(entries);

    // if (this.watcher.running) {
    //   await this.watcher.complete();
    // }
  }

  async bundle(entries) {
    let graph = await this.graphBuilder.build(this.cwd, entries);
    await this.bundleBuilder.build(graph, {
      destFolder: path.join(this.cwd, 'dist') // TODO: get through config instead of hardcoding
    });
  }

  // async onChange(event) {
  //   this.graphBuilder.update(event);
  // }
}

module.exports = Orchestrator;

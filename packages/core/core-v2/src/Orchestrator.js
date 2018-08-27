// @flow
'use strict';
const EventEmitter = require('events');
const path = require('path');
const Watcher = require('@parcel/watcher');
const { AbortController } = require('abortcontroller-polyfill/dist/cjs-ponyfill');
const GraphBuilder = require('./GraphBuilder');
const BundleBuilder = require('./BundleBuilder');

// TODO: use custom config if present
const config = require('@parcel/config-default');

class Orchestrator extends EventEmitter {
  constructor(entries, options) {
    super();

    this.cwd = process.cwd();
    this.entries = entries;
    this.watcher = new Watcher();
    // this.hmrServer = new HmrServer();

    this.graphBuilder = new GraphBuilder(config, {});
    this.bundleBuilder = new BundleBuilder(config, options);
  }

  async run() {
    let controller = new AbortController();
    let signal = controller.signal;

    if (/* this.options.watch */ true) this.watcher.watch(this.cwd);

    this.watcher.on('change', event => {
      controller.abort();
      this.graphBuilder.handleChange(event);

      controller = new AbortController();
      signal = controller.signal;
      this.bundle({ signal });
    });
  }

  async bundle({ signal }) {
     try {
      let graph = await this.graphBuilder.build({ signal });
      await this.bundleBuilder.build(graph, {
        signal,
        destFolder: path.join(this.cwd, 'dist') // TODO: get through config instead of hardcoding
      });
     } catch (e) {
      console.log(e);
     }

  }
}

module.exports = Orchestrator;

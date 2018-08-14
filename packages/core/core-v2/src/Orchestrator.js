// @flow
'use strict';
const EventEmitter = require('events');

class Orchestrator extends EventEmitter {
  constructor(entries) {

    this.watcher = new Watcher();
    this.hmrServer = new HmrServer();

    this.entries = entries;
    
    this.assetGraphBuilder = new AssetGraphBuilder();
    this.bundleBuilder = new BundleBuilder();
    
    this.assetGraphBuilder.on('complete', (assetGraph) => {
      this.bundleBuilder.build(assetGraph);
    });
    
  }

  async bundle() {
    this.assetGraphBuilder.build(this.entries);

    if (this.options.watch) {
      this.watcher.on('change', this.onChange.bind(this));
    }
  }

  async onChange(event) {
    this.assetGraphBuilder.update(event);
  }
}

module.exports = Orchestrator;

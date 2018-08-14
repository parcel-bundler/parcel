// @flow
'use strict';
const EventEmitter = require('events');

class Orchestrator extends EventEmitter {
  constructor() {
    this.resolver = new Resolver();
    this.workerFarm = new WorkerFarm();
    this.transformerQueue = new TransformQueue();
    this.packagerQueue = new PackagerQueue();
    this.watcher = new Watcher();
    this.hmrServer = new HmrServer();
  }

  async bundle() {
    // ...
  }
}

module.exports = Orchestrator;

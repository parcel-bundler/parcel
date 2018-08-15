// @flow
'use strict';
const AssetGraph = require('./AssetGraph');
const Queue = require('./Queue');
const Emittery = require('emittery');

class AssetGraphBuilder extends Emittery {
  constructor() {
    super();
    
    this.assetGraph = new AssetGraph();
    this.queue = new Queue();
    this.resolver = new Resolver();
    this.on('change', this.handleChange);
  }

  async build(entries, { signal }) {
    signal.addEventListener('abort', () => {
      // prune asset graph??
      reject(new AbortError());
    });

    await this.queue.workThroughAllTheThings(this.process, { signal });
  }

  async process(item) {
    if (isNode(item)) {
     // process node
    } else if (isEdge(item)) {
      // process edge
    } else {
      throw 'wtf';
    }

    // or happens implicitly via `workThroughAllTheThings()`,
    this.queue.remove(item);
  }

  // async processModuleRequest(moduleRequest) {
  //   let resolvedPath = this.resolver.resolve(moduleRequest);
  //
  // }
  //
  // async transformInWorker(filePath) {
  //
  // }

  // entries.forEach((moduleSpecifier) => {
  //   this.processModuleRequest({
  //     srcPath: cwd,
  //     moduleSpecifier
  //   })
  // });

  handleChange(event) {
    if (event.type === 'added')  {
      // ...
    } else if (event.type === 'changed') {
      let node = this.assetGraph.findNodeByX(event.x);
      this.queue.enqueue(node);
    } else if (event.type === 'unlinked') {
      let node = this.assetGraph.findNodeByX(event.x);
      let invalidated = this.assetGraph.removeNode(node);
      this.queue.enqueue(...invalidated);
    } else {
      throw new Error('wtf is this');
    }
    // ...
  }
}

module.exports = AssetGraphBuilder;

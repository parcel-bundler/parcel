// @flow
'use strict';
const Graph = require('./Graph');
const Queue = require('./Queue');
const TransformerRunner = require('./TransformerRunner');
const ResolverRunner = require('./ResolverRunner');

class AssetGraphBuilder {
  constructor() {
    this.graph = new Graph();
    this.queue = new Queue();

    this.transformerRunner = new TransformerRunner();
    this.resolverRunner = new ResolverRunner();
  }

  async build(cwd, entries) {
    console.log(cwd, entries);
    this.graph.addNode({
      kind: 'node',
      id: cwd,
      value: cwd,
    });

    let entryEdges = entries.map(entry => {
      return {
        kind: 'edge',
        id: entry,
        from: cwd,
        to: null,
        value: {
          moduleRequest: entry,
        },
      };
    });

    this.queue.enqueue(...entryEdges);

    await this.queue.process(this.process);
  }

  async process(item) {
    if (item.type === 'node') {
      let what = this.transformerRunner.transform(item.value);
      // this.queue.enqueue(...newEdges...);
      this.graph.addNode(item);

    } else if (item.type === 'edge') {
      let resolved = this.resolverRunner.resolve(item.value);
      // this.queue.enqueue(...resolved...);
      this.graph.addEdge(item);

    } else {
      throw new Error('Unexpected queue item type');
    }
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

  // handleChange(event) {
  //   if (event.type === 'added')  {
  //     // ...
  //   } else if (event.type === 'changed') {
  //     let node = this.graph.findNodeByX(event.x);
  //     this.queue.enqueue(node);
  //   } else if (event.type === 'unlinked') {
  //     let node = this.graph.findNodeByX(event.x);
  //     let invalidated = this.graph.removeNode(node);
  //     this.queue.enqueue(...invalidated);
  //   } else {
  //     throw new Error('wtf is this');
  //   }
  //   // ...
  // }
}

module.exports = AssetGraphBuilder;

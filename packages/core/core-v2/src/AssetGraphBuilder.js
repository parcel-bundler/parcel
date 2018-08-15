// @flow
'use strict';
const EventEmitter = require('events');
const PQueue = require('p-queue');
const Graph = require('./Graph');
const Queue = require('./Queue');
const TransformerRunner = require('./TransformerRunner');
const ResolverRunner = require('./ResolverRunner');

// que + corall, get it?
export default class Querral {
  constructor(queues) {
    this.queues = queues;
  }

  allDone() {
    let { queues } = this;
    
    return Promise.all(queues.map(q => q.onIdle())).then(() => {
      let unfinishedCounts = queues.map(q => (q.size + q.pending));
      let anyUndone = unfinishedCounts.some(count => (count > 0))

      if (anyUndone) {
        return this.allDone();
      }
    });
  }
}

class AssetGraphBuilder {
  constructor() {
    this.graph = new Graph();

    this.resolverQueue = new PQueue();
    this.transformerQueue = new PQueue();
    this.querral = new Querral([this.resolverQueue, this.transformerQueue]);

    this.transformerRunner = new TransformerRunner();
    this.resolverRunner = new ResolverRunner();
  }

  async build(cwd, entries) {
    this.graph.addNode({
      id: cwd,
      value: cwd,
    });

    entries
      .map(entry => ({
        sourcePath: 'cwd',
        moduleSpecifier: entry
      }))
      .forEach(moduleRequest => this.resolverQueue.add(() => this.resolve(moduleRequest)));

    await this.querral().allDone();

    return this.graph;
  }


  async resolve(moduleRequest) {
    let { sourcePath } = moduleRequest;
    let resolvedPath = await this.resolverRunner.resolve(moduleRequest);
    this.graph.addNode({
      id: resolvedPath,
      value: resolvedPath,
    });
    this.graph.addEdge({ from: sourcePath, to: resolvedPath });
    this.transformerQueue.add(() => this.transform({ filePath: resolvedPath }));
  }

  async transform(asset) {
    let transformedAsset = await this.transformerRunner.transform(asset);
    transformedAsset.dependencies.forEach(({ moduleSpecifier }) => 
      this.resolverQueue.add(() => this.resolve({ sourcePath: asset.filePath, moduleSpecifier }));
    );
  }
}

module.exports = AssetGraphBuilder;

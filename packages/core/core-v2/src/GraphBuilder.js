// @flow
'use strict';
const EventEmitter = require('events');
const PQueue = require('p-queue');
const Graph = require('./Graph');
const Queue = require('./Queue');
const TransformerRunner = require('./TransformerRunner');
const ResolverRunner = require('./ResolverRunner');

// que + corall, get it?
class Querral {
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

class GraphBuilder {
  constructor(config, options) {
    this.graph = new Graph();

    this.resolverQueue = new PQueue();
    this.transformerQueue = new PQueue();
    this.querral = new Querral([this.resolverQueue, this.transformerQueue]);

    this.transformerRunner = new TransformerRunner(config, options);
    this.resolverRunner = new ResolverRunner();
  }

  async build(cwd, entries) {
    this.graph.addNode({
      id: cwd,
      type: 'root',
      value: cwd,
    });

    for (let entry of entries) {
      let dep = {
        parentId: entry,
        sourcePath: cwd,
        moduleSpecifier: entry
      };

      this.graph.addNode({
        id: entry,
        type: 'dep',
        value: dep
      });

      this.graph.addEdge({from: cwd, to: entry});

      this.resolverQueue.add(() => this.resolve(dep));
    }

    await this.querral.allDone();

    return this.graph;
  }


  async resolve(moduleRequest) {
    let resolvedPath = await this.resolverRunner.resolve(moduleRequest);
    this.graph.addNode({
      id: resolvedPath,
      type: 'file',
      value: resolvedPath,
    });
    this.graph.addEdge({ from: moduleRequest.parentId, to: resolvedPath });
    this.transformerQueue.add(() => this.transform({ filePath: resolvedPath }));
  }

  async transform(asset) {
    let transformedAsset = await this.transformerRunner.transform(asset);
    for (let child of transformedAsset.children) {
      this.graph.addNode({
        id: child.hash,
        type: 'asset',
        value: child
      });

      this.graph.addEdge({from: asset.filePath, to: child.hash});

      for (let dep of child.dependencies) {
        let depId = child.hash + ':' + dep.moduleSpecifier;
        this.graph.addNode({
          id: depId,
          type: 'dep',
          value: dep
        });

        this.graph.addEdge({from: child.hash, to: depId});
        this.resolverQueue.add(() => this.resolve({ parentId: depId, sourcePath: asset.filePath, moduleSpecifier: dep.moduleSpecifier }));
      }
    }
  }
}

module.exports = GraphBuilder;

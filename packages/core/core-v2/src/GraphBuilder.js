// @flow
'use strict';
const EventEmitter = require('events');
const PQueue = require('p-queue');
const Graph = require('./Graph');
const TransformerRunner = require('./TransformerRunner');
const ResolverRunner = require('./ResolverRunner');

const AbortError = new Error('Aborted!');

class GraphBuilder {
  constructor(config, options) {
    this.config = config;
    this.graph = new Graph();
    this.initializeGraph();
    this.incompleteNodes = new Set();

    this.queue = new PQueue({
      autoStart: false,
    });

    this.transformerRunner = new TransformerRunner(config, options);
    this.resolverRunner = new ResolverRunner(config, options);
  }

  initializeGraph() {
    let { rootDir, entries } = this.config;

    let rootNode = this.addRootNode(rootDir);

    for (let entry of this.config.entries) {
      let dependency = {
        sourcePath: rootDir,
        moduleSpecifier: entry,
      }
      this.addDependencyNode(rootDir, dependency);
    }
  }

  addRootNode(root) {
    let rootNode = {
      id: rootDir,
      type: 'root',
      value: rootDir,
    };
    this.graph.addNode(rootNode);
  }

  addDependencyNode(from, dep) {
    let depNode = {
      id: from + ':' + dep.moduleSpecifier,
      type: 'dep',
      value: dep,
    };
    this.graph.addNode(depNode);
    this.graph.addEdge({ from, to: depNode.id });
    this.incompleteNodes.add(depNode);
  }

  addFileNode(from, file) {
    let fileNode = {
      id: resolvedPath,
      type: 'file',
      value: resolvedPath,
    };
    this.graph.addNode(fileNode);
    this.graph.addEdge(from.id, fileNode.id);
    this.incompleteNodes.delete(from);
    this.incompleteNodes.add(fileNode)
  }

  addAssetNode(from, asset) {
    this.graph.addNode({
      id: child.hash,
      type: 'asset',
      value: child
    });

    this.graph.addEdge({from: asset.filePath, to: child.hash});
    this.incompleteNodes.delete(from);
  }

  async build({ signal }) {
    return new Promise(async (resolve, reject) => {
      if (signal.aborted) reject(AbortError);

      signal.addEventListener('abort', () => {
        this.queue.pause(); // Is this necessary?
        this.queue.clear();
        return reject(AbortError);
      });

      for (let node of this.incompleteNodes) {
        this.queue.add(() => this.processNode(node, { signal }));
      }

      this.queue.start();

      await this.queue.onIdle();

      return resolve(this.graph);
    });
  }

  processNode(node, { signal }) {
    if (node.type === 'dependency') {
      return this.resolve(node, { signal });
    } else if (node.type === 'file') {
      return this.transform(node, { signal })
    }
  }

  async resolve(depNode, { signal }) {
    let resolvedPath = await this.resolverRunner.resolve(depNode.value);
    if (!signal.aborted) {
      let file = { filePath: resolvedPath };
      let fileNode = this.addFileNode(depNode, file);
      this.queue.add(() => this.transform(fileNode, { signal }));
    }
  }

  async tranform(fileNode, { signal }) {
    let childAssets = await this.transformerRunner.transform(fileNode.value);

    if (!signal.aborted) {
      for (let asset of childAssets) {
        let assetNode = this.addAssetNode(fileNode, asset);

        for (let dep of asset.dependencies) {
          let depNode = this.addDependencyNode(assetNode, dep);
          this.queue.add(() => this.resolve(depNode, { signal }))
        }
      }
    }
  }

  handleChange(filePath) {
    let fileNode = this.graph.nodes.get(filePath);
    this.incompleteNodes.add(fileNode);
  }
}

module.exports = GraphBuilder;

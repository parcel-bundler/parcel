// @flow
'use strict';
const EventEmitter = require('events');
const PQueue = require('p-queue');
const Graph = require('./Graph');
const TransformerRunner = require('./TransformerRunner');
const ResolverRunner = require('./ResolverRunner');

const AbortError = new Error('Aborted!');

class GraphBuilder {
  constructor({
    entries,
    rootDir,
    parcelConfig,
    cliOpts
  }) {
    this.graph = new Graph();
    this.incompleteNodes = new Set();
    this.initializeGraph({ entries, rootDir });

    this.queue = new PQueue({
      autoStart: false,
    });

    this.transformerRunner = new TransformerRunner(parcelConfig, {});
    this.resolverRunner = new ResolverRunner(parcelConfig, cliOpts);
  }

  initializeGraph({ entries, rootDir }) {
    let rootNode = {
      id: '@@root',
      type: 'root',
    };
    this.graph.addNode(rootNode);

    for (let entry of entries) {
      let dependency = {
        sourcePath: rootDir,
        moduleSpecifier: entry,
      }
      this.addDependencyNode(rootNode, dependency);
    }
  }

  addDependencyNode(from, dep) {
    let depNode = {
      id: from.id + ':' + dep.moduleSpecifier,
      type: 'dependency',
      value: dep,
    };
    this.graph.addNode(depNode);
    this.graph.addEdge({ from: from.id, to: depNode.id });
    this.incompleteNodes.add(depNode);

    return depNode;
  }

  addFileNode(from, file) {
    let fileNode = {
      id: file.filePath,
      type: 'file',
      value: file,
    };
    this.graph.addNode(fileNode);
    this.graph.addEdge({ from: from.id, to: fileNode.id });
    this.incompleteNodes.delete(from);
    this.incompleteNodes.add(fileNode);

    return fileNode;
  }

  addAssetNode(from, asset) {
    let assetNode = {
      id: asset.hash,
      type: 'asset',
      value: asset
    }
    this.graph.addNode(assetNode);
    this.graph.addEdge({ from: from.id, to: assetNode.id });
    this.incompleteNodes.delete(from);

    return assetNode;
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
    // console.log('resolving depNode', depNode)
    let resolvedPath = await this.resolverRunner.resolve(depNode.value);
    if (!signal.aborted) {
      let file = { filePath: resolvedPath };
      let fileNode = this.addFileNode(depNode, file);
      this.queue.add(() => this.transform(fileNode, { signal }));
    }
  }

  async transform(fileNode, { signal }) {
    // console.log('transforming fileNode', fileNode)
    let { children: childAssets } = await this.transformerRunner.transform(fileNode.value);

    if (!signal.aborted) {
      for (let asset of childAssets) {
        let assetNode = this.addAssetNode(fileNode, asset);

        for (let dep of asset.dependencies) {
          dep.sourcePath = fileNode.value.filePath; // ? Should this be done elsewhere?
          let depNode = this.addDependencyNode(assetNode, dep);
          this.queue.add(() => this.resolve(depNode, { signal }));
        }
      }
    }
  }

  handleChange(filePath) {
    let fileNode = this.graph.nodes.get(filePath);
    if (fileNode) this.incompleteNodes.add(fileNode);
  }
}

module.exports = GraphBuilder;

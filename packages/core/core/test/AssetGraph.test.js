// @flow
'use strict';
import assert from 'assert';

import AssetGraph, {nodeFromFile, nodeFromDep} from '../src/AssetGraph';

describe('AssetGraph', () => {
  it('initialization should create one root node with edges to dependency nodes for each entry', () => {
    let graph = new AssetGraph({
      entries: ['./index1', './index2'],
      rootDir: '/'
    });

    assert(graph.nodes.has('/'));
    assert(graph.nodes.has('/:./index1'));
    assert(graph.nodes.has('/:./index2'));
    assert.deepEqual(
      graph.edges,
      new Set([{from: '/', to: '/:./index1'}, {from: '/', to: '/:./index2'}])
    );
  });

  it('updateDependency should update the file a dependency is connected to', () => {
    let graph = new AssetGraph({
      entries: ['./index'],
      rootDir: '/'
    });

    let dep = {sourcePath: '/', moduleSpecifier: './index'};
    let file = {filePath: '/index.js'};

    graph.updateDependency(dep, file);
    assert(graph.nodes.has('/index.js'));
    assert(graph.hasEdge({from: '/:./index', to: '/index.js'}));
    assert(graph.incompleteNodes.has(nodeFromFile(file).id));

    file = {filePath: '/index.jsx'};
    graph.updateDependency(dep, {filePath: '/index.jsx'});
    assert(!graph.nodes.has('/index.js'));
    assert(graph.nodes.has('/index.jsx'));
    assert(graph.hasEdge({from: '/:./index', to: '/index.jsx'}));
    assert(!graph.hasEdge({from: '/:./index', to: '/index.js'}));
    assert(graph.incompleteNodes.has(nodeFromFile(file).id));

    graph.updateDependency(dep, file);
    assert(graph.nodes.has('/index.jsx'));
    assert(graph.hasEdge({from: '/:./index', to: '/index.jsx'}));
    assert(graph.incompleteNodes.has(nodeFromFile(file).id));
  });

  it('updateFile should update the asset and dep nodes a file is connected to', () => {
    let graph = new AssetGraph({
      entries: ['./index'],
      rootDir: '/'
    });

    let dep = {sourcePath: '/', moduleSpecifier: './index'};
    let filePath = '/index.js';
    let file = {filePath};
    graph.updateDependency(dep, file);
    let sourcePath = filePath;
    let assets = [
      {
        filePath,
        hash: '#1',
        dependencies: [{sourcePath, moduleSpecifier: './utils'}]
      },
      {
        filePath,
        hash: '#2',
        dependencies: [{sourcePath, moduleSpecifier: './styles'}]
      },
      {filePath, hash: '#3', dependencies: []}
    ];
    graph.updateFile(file, assets);
    assert(graph.nodes.has('#1'));
    assert(graph.nodes.has('#2'));
    assert(graph.nodes.has('#3'));
    assert(graph.nodes.has('/index.js:./utils'));
    assert(graph.nodes.has('/index.js:./styles'));
    assert(graph.hasEdge({from: '/index.js', to: '#1'}));
    assert(graph.hasEdge({from: '/index.js', to: '#2'}));
    assert(graph.hasEdge({from: '/index.js', to: '#3'}));
    assert(graph.hasEdge({from: '#1', to: '/index.js:./utils'}));
    assert(graph.hasEdge({from: '#2', to: '/index.js:./styles'}));
    assert(!graph.incompleteNodes.has(nodeFromFile(file).id));
    assert(
      graph.incompleteNodes.has(
        nodeFromDep({sourcePath, moduleSpecifier: './utils'}).id
      )
    );
    assert(
      graph.incompleteNodes.has(
        nodeFromDep({sourcePath, moduleSpecifier: './styles'}).id
      )
    );

    assets = [
      {
        filePath,
        hash: '#1',
        dependencies: [{sourcePath, moduleSpecifier: './utils'}]
      },
      {filePath, hash: '#2', dependencies: []}
    ];
    graph.updateFile(file, assets);
    assert(graph.nodes.has('#1'));
    assert(graph.nodes.has('#2'));
    assert(!graph.nodes.has('#3'));
    assert(graph.nodes.has('/index.js:./utils'));
    assert(!graph.nodes.has('/index.js:./styles'));
    assert(graph.hasEdge({from: '/index.js', to: '#1'}));
    assert(graph.hasEdge({from: '/index.js', to: '#2'}));
    assert(!graph.hasEdge({from: '/index.js', to: '#3'}));
    assert(graph.hasEdge({from: '#1', to: '/index.js:./utils'}));
    assert(!graph.hasEdge({from: '#2', to: '/index.js:./styles'}));
    assert(!graph.incompleteNodes.has(nodeFromFile(file).id));
    assert(
      graph.incompleteNodes.has(
        nodeFromDep({sourcePath, moduleSpecifier: './utils'}).id
      )
    );
    assert(
      !graph.incompleteNodes.has(
        nodeFromDep({sourcePath, moduleSpecifier: './styles'}).id
      )
    );
  });
});

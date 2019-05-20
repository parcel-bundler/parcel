// @flow

import assert from 'assert';

import Graph from '../src/Graph';

describe('Graph', () => {
  it('constructor should initialize an empty graph', () => {
    let graph = new Graph();
    assert.deepEqual(graph.nodes, new Map());
    assert.deepEqual(graph.getAllEdges(), []);
  });

  it('addNode should add a node to the graph', () => {
    let graph = new Graph();
    let node = {id: 'a', value: 'a'};
    graph.addNode(node);
    assert.equal(graph.nodes.get(node.id), node);
  });

  it('hasNode should return a boolean based on whether the node exists in the graph', () => {
    let graph = new Graph();
    let node = {id: 'a', value: 'a'};
    graph.addNode(node);
    assert(graph.hasNode(node.id));
    assert(!graph.hasNode('b'));
  });

  it('addEdge should add an edge to the graph', () => {
    let graph = new Graph();
    graph.addEdge('a', 'b');
    assert(graph.hasEdge('a', 'b'));
  });

  it('isOrphanedNode should return true or false if the node is orphaned or not', () => {
    let graph = new Graph();
    let nodeA = {id: 'a', value: 'a'};
    let nodeB = {id: 'b', value: 'b'};
    graph.addNode(nodeA);
    graph.addNode(nodeB);
    graph.addEdge('a', 'b');
    assert(graph.isOrphanedNode(nodeA));
    assert(!graph.isOrphanedNode(nodeB));
  });

  it('removeEdge should prune the graph at that edge', () => {
    let graph = new Graph();
    graph.addNode({id: 'a', value: 'a'});
    graph.addNode({id: 'b', value: 'b'});
    graph.addNode({id: 'c', value: 'c'});
    graph.addNode({id: 'd', value: 'd'});
    graph.addEdge('a', 'b');
    graph.addEdge('a', 'd');
    graph.addEdge('b', 'c');
    graph.addEdge('b', 'd');

    let removed = graph.removeEdge('a', 'b');
    assert(graph.nodes.has('a'));
    assert(graph.nodes.has('d'));
    assert(!graph.nodes.has('b'));
    assert(!graph.nodes.has('c'));
    assert.deepEqual(graph.getAllEdges(), [{from: 'a', to: 'd'}]);
    assert(removed.nodes.has('b'));
    assert(removed.nodes.has('c'));
    assert.deepEqual(removed.getAllEdges(), [
      {from: 'a', to: 'b'},
      {from: 'b', to: 'c'},
      {from: 'b', to: 'd'}
    ]);
  });

  it("updateNodeDownStream should update a node's downstream nodes", () => {
    let graph = new Graph();
    let nodeA = graph.addNode({id: 'a', value: 'a'});
    let nodeB = graph.addNode({id: 'b', value: 'b'});
    graph.addNode({id: 'c', value: 'c'});
    graph.addEdge('a', 'b');
    graph.addEdge('a', 'c');

    let nodeD = {id: 'd', value: 'd'};
    let {removed} = graph.replaceNodesConnectedTo(nodeA, [nodeB, nodeD]);

    assert(graph.nodes.has('a'));
    assert(graph.nodes.has('b'));
    assert(!graph.nodes.has('c'));
    assert(graph.nodes.has('d'));
    assert.deepEqual(graph.getAllEdges(), [
      {from: 'a', to: 'b'},
      {from: 'a', to: 'd'}
    ]);
    assert(removed.nodes.has('c'));
    assert.deepEqual(removed.getAllEdges(), [{from: 'a', to: 'c'}]);
  });
});

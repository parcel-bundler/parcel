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
    let edge = {from: 'a', to: 'b'};
    graph.addEdge(edge);
    assert(graph.hasEdge(edge));
  });

  it('isOrphanedNode should return true or false if the node is orphaned or not', () => {
    let graph = new Graph();
    let nodeA = {id: 'a', value: 'a'};
    let nodeB = {id: 'b', value: 'b'};
    graph.addNode(nodeA);
    graph.addNode(nodeB);
    graph.addEdge({from: 'a', to: 'b'});
    assert(graph.isOrphanedNode(nodeA));
    assert(!graph.isOrphanedNode(nodeB));
  });

  it('removeEdge should prune the graph at that edge', () => {
    let graph = new Graph();
    graph.addNode({id: 'a', value: 'a'});
    graph.addNode({id: 'b', value: 'b'});
    graph.addNode({id: 'c', value: 'c'});
    graph.addNode({id: 'd', value: 'd'});
    let edgeAB = graph.addEdge({from: 'a', to: 'b'});
    let edgeAD = graph.addEdge({from: 'a', to: 'd'});
    let edgeBC = graph.addEdge({from: 'b', to: 'c'});
    let edgeBD = graph.addEdge({from: 'b', to: 'd'});

    let removed = graph.removeEdge(edgeAB);
    assert(graph.nodes.has('a'));
    assert(graph.nodes.has('d'));
    assert(!graph.nodes.has('b'));
    assert(!graph.nodes.has('c'));
    assert.deepEqual(graph.getAllEdges(), [edgeAD]);
    assert(removed.nodes.has('b'));
    assert(removed.nodes.has('c'));
    assert.deepEqual(removed.getAllEdges(), [edgeAB, edgeBC, edgeBD]);
  });

  it("updateNodeDownStream should update a node's downstream nodes", () => {
    let graph = new Graph();
    let nodeA = graph.addNode({id: 'a', value: 'a'});
    let nodeB = graph.addNode({id: 'b', value: 'b'});
    graph.addNode({id: 'c', value: 'c'});
    let edgeAB = graph.addEdge({from: 'a', to: 'b'});
    let edgeAC = graph.addEdge({from: 'a', to: 'c'});

    let nodeD = {id: 'd', value: 'd'};
    let edgeAD = {from: 'a', to: 'd'};

    let {removed} = graph.replaceNodesConnectedTo(nodeA, [nodeB, nodeD]);

    assert(graph.nodes.has('a'));
    assert(graph.nodes.has('b'));
    assert(!graph.nodes.has('c'));
    assert(graph.nodes.has('d'));
    assert.deepEqual(graph.getAllEdges(), [edgeAB, edgeAD]);
    assert(removed.nodes.has('c'));
    assert.deepEqual(removed.getAllEdges(), [edgeAC]);
  });
});

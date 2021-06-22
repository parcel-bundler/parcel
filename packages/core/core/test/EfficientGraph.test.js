// @flow strict-local

import assert from 'assert';

import EfficientGraph, {NODE_SIZE, EDGE_SIZE} from '../src/EfficientGraph';
import {toNodeId} from '../src/types';

describe('EfficientGraph', () => {
  it('constructor should initialize an empty graph', () => {
    let graph = new EfficientGraph(1, 1);
    assert.deepEqual(graph.nodes, new Uint32Array(1 * NODE_SIZE));
    assert.deepEqual(graph.edges, new Uint32Array(1 * EDGE_SIZE));
    assert.equal(graph.numNodes, 0);
    assert.equal(graph.numEdges, 0);
  });

  it('addNode should add a node to the graph', () => {
    let graph = new EfficientGraph();
    let id = graph.addNode();
    assert.equal(id, 0);
    assert.equal(graph.numNodes, 1);
  });

  it('addNode should resize nodes array when necessary', () => {
    let graph = new EfficientGraph(1);
    graph.addNode();
    assert.deepEqual(graph.nodes, new Uint32Array(2 * NODE_SIZE));
    graph.addNode();
    assert.deepEqual(graph.nodes, new Uint32Array(4 * NODE_SIZE));
    graph.addNode();
    assert.deepEqual(graph.nodes, new Uint32Array(4 * NODE_SIZE));
    graph.addNode();
    assert.deepEqual(graph.nodes, new Uint32Array(8 * NODE_SIZE));
  });

  it('removeEdge should remove an edge from the graph', () => {
    let graph = new EfficientGraph();
    let node0 = graph.addNode();
    let node1 = graph.addNode();
    let node2 = graph.addNode();
    let node3 = graph.addNode();
    let node4 = graph.addNode();
    let node5 = graph.addNode();
    let node6 = graph.addNode();
    graph.addEdge(node0, node1);
    graph.addEdge(node2, node1);
    // this will get removed
    graph.addEdge(node3, node1);
    graph.addEdge(node4, node1);
    graph.addEdge(node5, node1);
    graph.addEdge(node6, node1);

    assert.deepEqual([...graph.getNodesConnectedTo(node1)], [0, 2, 3, 4, 5, 6]);

    graph.removeEdge(node3, node1);
    assert.deepEqual([...graph.getNodesConnectedTo(node1)], [0, 2, 4, 5, 6]);
  });

  it('removeEdge should remove an edge of a specific type from the graph', () => {
    let graph = new EfficientGraph(2, 5);
    let a = graph.addNode();
    let b = graph.addNode();
    let c = graph.addNode();
    let d = graph.addNode();
    graph.addEdge(a, b);
    graph.addEdge(a, b, 2);
    graph.addEdge(a, b, 3);
    graph.addEdge(a, c);
    graph.addEdge(a, d, 3);
    assert.equal(graph.numEdges, 5);
    assert.ok(graph.hasEdge(a, b));
    assert.ok(graph.hasEdge(a, b, 2));
    assert.ok(graph.hasEdge(a, b, 3));
    assert.ok(graph.hasEdge(a, c));
    assert.ok(graph.hasEdge(a, d, 3));
    assert.deepEqual(graph.getAllEdges(), [
      {from: a, to: b, type: 1},
      {from: a, to: b, type: 2},
      {from: a, to: b, type: 3},
      {from: a, to: c, type: 1},
      {from: a, to: d, type: 3},
    ]);

    graph.removeEdge(a, b, 2);
    assert.equal(graph.numEdges, 4);
    assert.ok(graph.hasEdge(a, b));
    assert.equal(graph.hasEdge(a, b, 2), false);
    assert.ok(graph.hasEdge(a, b, 3));
    assert.ok(graph.hasEdge(a, c));
    assert.ok(graph.hasEdge(a, d, 3));
    assert.deepEqual(graph.getAllEdges(), [
      {from: a, to: b, type: 1},
      {from: a, to: b, type: 3},
      {from: a, to: c, type: 1},
      {from: a, to: d, type: 3},
    ]);
  });

  it('addEdge should add an edge to the graph', () => {
    let graph = new EfficientGraph(2, 1);
    let a = graph.addNode();
    let b = graph.addNode();
    graph.addEdge(a, b);
    assert.equal(graph.numNodes, 2);
    assert.equal(graph.numEdges, 1);
    assert.ok(graph.hasEdge(a, b));
  });

  it('addEdge should add multiple edges from a node in order', () => {
    let graph = new EfficientGraph();
    let a = graph.addNode();
    let b = graph.addNode();
    let c = graph.addNode();
    let d = graph.addNode();
    graph.addEdge(a, b);
    graph.addEdge(a, d);
    graph.addEdge(a, c);
    assert.deepEqual([...graph.getNodesConnectedFrom(a)], [b, d, c]);
  });

  it('addEdge should add multiple edges to a node in order', () => {
    let graph = new EfficientGraph();
    let a = graph.addNode();
    let b = graph.addNode();
    let c = graph.addNode();
    let d = graph.addNode();
    graph.addEdge(a, b);
    graph.addEdge(d, b);
    graph.addEdge(a, d);
    graph.addEdge(c, b);
    assert.deepEqual([...graph.getNodesConnectedTo(b)], [a, d, c]);
  });

  it('addEdge should add multiple edges of different types in order', () => {
    let graph = new EfficientGraph();
    let a = graph.addNode();
    let b = graph.addNode();
    graph.addEdge(a, b);
    graph.addEdge(a, b, 1);
    graph.addEdge(a, b, 4);
    graph.addEdge(a, b, 3);
    assert.deepEqual([...graph.getNodesConnectedFrom(a)], [b]);
    assert.deepEqual(graph.getAllEdges(), [
      {from: a, to: b, type: 1},
      {from: a, to: b, type: 4},
      {from: a, to: b, type: 3},
    ]);
  });

  it('addEdge should return false if an edge is already added', () => {
    let graph = new EfficientGraph();
    let a = graph.addNode();
    let b = graph.addNode();
    assert.equal(graph.addEdge(a, b), true);
    assert.equal(graph.addEdge(a, b), false);
  });

  it('addEdge should resize edges array when necessary', () => {
    let graph = new EfficientGraph(2, 1);
    let a = graph.addNode();
    let b = graph.addNode();
    let c = graph.addNode();
    assert.equal(graph.edges.length, EDGE_SIZE);
    graph.addEdge(a, b);
    assert.equal(graph.edges.length, EDGE_SIZE);
    graph.addEdge(a, c);
    assert.equal(graph.edges.length, EDGE_SIZE * 2);
  });

  it('addEdge should error when a node has not been added to the graph', () => {
    let graph = new EfficientGraph(2, 1);
    assert.throws(() => graph.addEdge(0, 1));
    graph.addNode();
    assert.throws(() => graph.addEdge(0, 1));
    graph.addNode();
    assert.doesNotThrow(() => graph.addEdge(0, 1));
    assert.throws(() => graph.addEdge(0, 2));
  });

  it('addEdge should error when an unsupported edge type is provided', () => {
    let graph = new EfficientGraph(2, 1);
    let a = graph.addNode();
    let b = graph.addNode();
    assert.throws(() => graph.addEdge(a, b, 0));
    assert.throws(() => graph.addEdge(a, b, -1));
    assert.doesNotThrow(() => graph.addEdge(a, b, 1));
  });
});

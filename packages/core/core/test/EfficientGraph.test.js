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

  it('removeNode should remove a node from the graph', () => {
    let graph = new EfficientGraph();
    let id = graph.addNode();
    assert.equal(graph.numNodes, 1);
    assert.ok(graph.removeNode(id));
    assert.equal(graph.numNodes, 0);
  });

  it('removeNode should not remove a node that is not in the graph', () => {
    let graph = new EfficientGraph();
    graph.addNode();
    assert.equal(graph.numNodes, 1);
    assert.equal(graph.removeNode(toNodeId(-1)), false);
    assert.equal(graph.numNodes, 1);
  });

  it('removeNode should error when a node still has edges in the graph', () => {
    let graph = new EfficientGraph();
    let a = graph.addNode();
    let b = graph.addNode();
    graph.addEdge(a, b);
    assert.throws(() => graph.removeNode(a));
    assert.throws(() => graph.removeNode(b));
  });
});

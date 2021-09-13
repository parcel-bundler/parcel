// @flow strict-local

import assert from 'assert';
import path from 'path';
import {Worker} from 'worker_threads';

import AdjacencyList, {
  NODES_HEADER_SIZE,
  EDGES_HEADER_SIZE,
} from '../src/AdjacencyList';
import {toNodeId} from '../src/types';

describe('AdjacencyList', () => {
  it('constructor should initialize an empty graph', () => {
    let stats = new AdjacencyList({
      nodeCapacity: 1,
      edgeCapacity: 1,
    }).stats;
    assert(stats.nodes === 0);
    assert(stats.edges === 0);
  });

  it('addNode should add a node to the graph', () => {
    let graph = new AdjacencyList();
    let id = graph.addNode();
    assert.equal(id, 0);
    assert.equal(graph.stats.nodes, 1);
  });

  it('addNode should resize nodes array when necessary', () => {
    let graph = new AdjacencyList({nodeCapacity: 1});
    let size = graph.serialize().nodes.length;
    graph.addNode();
    assert(size < (size = graph.serialize().nodes.length));
    graph.addNode();
    assert(size < (size = graph.serialize().nodes.length));
    graph.addNode();
    assert(size === graph.serialize().nodes.length);
    graph.addNode();
    assert(size < graph.serialize().nodes.length);
  });

  it('removeEdge should remove an edge from the graph', () => {
    let graph = new AdjacencyList();
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

    assert.deepEqual(graph.getNodesConnectedTo(node1), [0, 2, 3, 4, 5, 6]);

    graph.removeEdge(node3, node1);
    assert.deepEqual(graph.getNodesConnectedTo(node1), [0, 2, 4, 5, 6]);
  });

  it('removeEdge should remove an edge of a specific type from the graph', () => {
    let graph = new AdjacencyList({nodeCapacity: 2, edgeCapacity: 5});
    let a = graph.addNode();
    let b = graph.addNode();
    let c = graph.addNode();
    let d = graph.addNode();
    graph.addEdge(a, b);
    graph.addEdge(a, b, 2);
    graph.addEdge(a, b, 3);
    graph.addEdge(a, c);
    graph.addEdge(a, d, 3);
    assert.equal(graph.stats.edges, 5);
    assert.ok(graph.hasEdge(a, b));
    assert.ok(graph.hasEdge(a, b, 2));
    assert.ok(graph.hasEdge(a, b, 3));
    assert.ok(graph.hasEdge(a, c));
    assert.ok(graph.hasEdge(a, d, 3));
    assert.deepEqual(Array.from(graph.getAllEdges()), [
      {from: a, to: b, type: 1},
      {from: a, to: b, type: 2},
      {from: a, to: b, type: 3},
      {from: a, to: c, type: 1},
      {from: a, to: d, type: 3},
    ]);

    graph.removeEdge(a, b, 2);
    assert.equal(graph.stats.edges, 4);
    assert.ok(graph.hasEdge(a, b));
    assert.equal(graph.hasEdge(a, b, 2), false);
    assert.ok(graph.hasEdge(a, b, 3));
    assert.ok(graph.hasEdge(a, c));
    assert.ok(graph.hasEdge(a, d, 3));
    assert.deepEqual(Array.from(graph.getAllEdges()), [
      {from: a, to: b, type: 1},
      {from: a, to: b, type: 3},
      {from: a, to: c, type: 1},
      {from: a, to: d, type: 3},
    ]);
  });

  it('addEdge should add an edge to the graph', () => {
    let graph = new AdjacencyList({nodeCapacity: 2, edgeCapacity: 1});
    let a = graph.addNode();
    let b = graph.addNode();
    graph.addEdge(a, b);
    assert.equal(graph.stats.nodes, 2);
    assert.equal(graph.stats.edges, 1);
    assert.ok(graph.hasEdge(a, b));
  });

  it('addEdge should add multiple edges from a node in order', () => {
    let graph = new AdjacencyList();
    let a = graph.addNode();
    let b = graph.addNode();
    let c = graph.addNode();
    let d = graph.addNode();
    graph.addEdge(a, b);
    graph.addEdge(a, d);
    graph.addEdge(a, c);
    assert.deepEqual(graph.getNodesConnectedFrom(a), [b, d, c]);
  });

  it('addEdge should add multiple edges to a node in order', () => {
    let graph = new AdjacencyList();
    let a = graph.addNode();
    let b = graph.addNode();
    let c = graph.addNode();
    let d = graph.addNode();
    graph.addEdge(a, b);
    graph.addEdge(d, b);
    graph.addEdge(a, d);
    graph.addEdge(c, b);
    assert.deepEqual(graph.getNodesConnectedTo(b), [a, d, c]);
  });

  it('addEdge should add multiple edges of different types in order', () => {
    let graph = new AdjacencyList();
    let a = graph.addNode();
    let b = graph.addNode();
    graph.addEdge(a, b);
    graph.addEdge(a, b, 1);
    graph.addEdge(a, b, 4);
    graph.addEdge(a, b, 3);
    assert.deepEqual(graph.getNodesConnectedFrom(a), [b]);
    assert.deepEqual(Array.from(graph.getAllEdges()), [
      {from: a, to: b, type: 1},
      {from: a, to: b, type: 4},
      {from: a, to: b, type: 3},
    ]);
  });

  it('addEdge should return false if an edge is already added', () => {
    let graph = new AdjacencyList();
    let a = graph.addNode();
    let b = graph.addNode();
    assert.equal(graph.addEdge(a, b), true);
    assert.equal(graph.addEdge(a, b), false);
  });

  it('addEdge should resize edges array when necessary', () => {
    let graph = new AdjacencyList({nodeCapacity: 2, edgeCapacity: 1});
    let size = graph.serialize().edges.length;
    let a = graph.addNode();
    let b = graph.addNode();
    graph.addEdge(a, b, 1);
    graph.addEdge(a, b, 2);
    graph.addEdge(a, b, 3);
    assert(size < graph.serialize().edges.length);
  });

  it('addEdge should error when a node has not been added to the graph', () => {
    let graph = new AdjacencyList({nodeCapacity: 2, edgeCapacity: 1});
    assert.throws(() => graph.addEdge(toNodeId(0), toNodeId(1)));
    graph.addNode();
    assert.throws(() => graph.addEdge(toNodeId(0), toNodeId(1)));
    graph.addNode();
    assert.doesNotThrow(() => graph.addEdge(toNodeId(0), toNodeId(1)));
    assert.throws(() => graph.addEdge(toNodeId(0), toNodeId(2)));
  });

  it('addEdge should error when an unsupported edge type is provided', () => {
    let graph = new AdjacencyList({nodeCapacity: 2, edgeCapacity: 1});
    let a = graph.addNode();
    let b = graph.addNode();
    assert.throws(() => graph.addEdge(a, b, 0));
    assert.throws(() => graph.addEdge(a, b, -1));
    assert.doesNotThrow(() => graph.addEdge(a, b, 1));
  });

  it('addEdge should not replace a deleted edge if the edge was already added', () => {
    let graph = new AdjacencyList();
    // Mock hash fn to generate collisions
    // $FlowFixMe[cannot-write]
    graph.hash = () => 1;
    let n0 = graph.addNode();
    let n1 = graph.addNode();
    let n2 = graph.addNode();
    graph.addEdge(n0, n1, 1);
    graph.addEdge(n1, n2, 1);
    // $FlowFixMe[incompatible-type]
    let index: number = graph.indexOf(n1, n2, 1);
    assert(graph.serialize().edges[index] > 0);
    graph.removeEdge(n1, n2, 1);
    assert(!graph.serialize().edges[index]);
    graph.addEdge(n0, n1, 1);
    assert(!graph.serialize().edges[index]);
    assert(graph.stats.edges === 1);
  });

  it('addEdge should replace a deleted edge', () => {
    let graph = new AdjacencyList({edgeCapacity: 2});
    // Mock hash fn to generate collisions
    // $FlowFixMe[cannot-write]
    graph.hash = () => 1;
    let n0 = graph.addNode();
    let n1 = graph.addNode();
    graph.addEdge(n0, n1, 1);
    graph.addEdge(n0, n1, 2);
    // $FlowFixMe[incompatible-type]
    let index: number = graph.indexOf(n0, n1, 2);
    assert(graph.serialize().edges[index] > 0);
    assert(graph.serialize().edges[index]);
    graph.removeEdge(n0, n1, 2);
    assert(!graph.serialize().edges[index]);
    graph.addEdge(n0, n1, 2);
    assert(graph.serialize().edges[index] > 0);
    assert(graph.serialize().edges[index]);
  });

  describe('deserialize', function() {
    this.timeout(10000);

    it('should share the underlying data across worker threads', async () => {
      let graph = new AdjacencyList({nodeCapacity: 2, edgeCapacity: 5});
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      graph.addEdge(n0, n1, 1);
      graph.addEdge(n0, n1, 2);

      let worker = new Worker(
        path.join(__dirname, 'integration/adjacency-list-shared-array.js'),
      );

      let originalSerialized = graph.serialize();
      let originalNodes = [...originalSerialized.nodes];
      let originalEdges = [...originalSerialized.edges];
      let work = new Promise(resolve => worker.on('message', resolve));
      worker.postMessage(originalSerialized);
      let received = AdjacencyList.deserialize(await work);
      await worker.terminate();

      assert.deepEqual(received.serialize().nodes, graph.serialize().nodes);
      assert.deepEqual(received.serialize().edges, graph.serialize().edges);

      originalNodes.forEach((v, i) => {
        if (i < NODES_HEADER_SIZE) {
          assert.equal(v, received.serialize().nodes[i]);
          assert.equal(v, graph.serialize().nodes[i]);
        } else {
          assert.equal(v * 2, received.serialize().nodes[i]);
          assert.equal(v * 2, graph.serialize().nodes[i]);
        }
      });

      originalEdges.forEach((v, i) => {
        if (i < EDGES_HEADER_SIZE) {
          assert.equal(v, received.serialize().edges[i]);
          assert.equal(v, graph.serialize().edges[i]);
        } else {
          assert.equal(v * 2, received.serialize().edges[i]);
          assert.equal(v * 2, graph.serialize().edges[i]);
        }
      });
    });
  });
});

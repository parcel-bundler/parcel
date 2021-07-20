// @flow strict-local

import assert from 'assert';
import path from 'path';
import {Worker} from 'worker_threads';

import AdjacencyList, {
  NODE_SIZE,
  EDGE_SIZE,
  isDeleted,
} from '../src/AdjacencyList';
import {toNodeId} from '../src/types';

describe('AdjacencyList', () => {
  it('constructor should initialize an empty graph', () => {
    let graph = new AdjacencyList({
      nodeCapacity: 1,
      edgeCapacity: 1,
    }).serialize();
    assert.deepEqual(graph.nodes, new Uint32Array(1 * NODE_SIZE));
    assert.deepEqual(graph.edges, new Uint32Array(1 * EDGE_SIZE));
    assert.equal(graph.numNodes, 0);
    assert.equal(graph.numEdges, 0);
  });

  it('addNode should add a node to the graph', () => {
    let graph = new AdjacencyList();
    let id = graph.addNode();
    assert.equal(id, 0);
    assert.equal(graph.serialize().numNodes, 1);
  });

  it('addNode should resize nodes array when necessary', () => {
    let graph = new AdjacencyList({nodeCapacity: 1});
    graph.addNode();
    assert.deepEqual(graph.serialize().nodes, new Uint32Array(2 * NODE_SIZE));
    graph.addNode();
    assert.deepEqual(graph.serialize().nodes, new Uint32Array(4 * NODE_SIZE));
    graph.addNode();
    assert.deepEqual(graph.serialize().nodes, new Uint32Array(4 * NODE_SIZE));
    graph.addNode();
    assert.deepEqual(graph.serialize().nodes, new Uint32Array(8 * NODE_SIZE));
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
    assert.equal(graph.serialize().numEdges, 5);
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
    assert.equal(graph.serialize().numEdges, 4);
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
    assert.equal(graph.serialize().numNodes, 2);
    assert.equal(graph.serialize().numEdges, 1);
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
    let a = graph.addNode();
    let b = graph.addNode();
    let c = graph.addNode();
    assert.equal(graph.serialize().edges.length, EDGE_SIZE);
    graph.addEdge(a, b);
    assert.equal(graph.serialize().edges.length, EDGE_SIZE * 2);
    graph.addEdge(a, c);
    assert.equal(graph.serialize().edges.length, EDGE_SIZE * 4);
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
    let index = graph.indexOf(n0, n1, 1);
    assert(graph.serialize().edges[index] > 0);
    assert(!isDeleted(graph.serialize().edges[index]));
    graph.removeEdge(n0, n1, 1);
    assert(isDeleted(graph.serialize().edges[index]));
    graph.addEdge(n1, n2, 1);
    assert(isDeleted(graph.serialize().edges[index]));
    assert(graph.serialize().numEdges === 1);
  });

  it('addEdge should replace a deleted edge', () => {
    let graph = new AdjacencyList();
    let n0 = graph.addNode();
    let n1 = graph.addNode();
    graph.addEdge(n0, n1, 1);
    let index = graph.indexOf(n0, n1, 1);
    assert(graph.serialize().edges[index] > 0);
    assert(!isDeleted(graph.serialize().edges[index]));
    graph.removeEdge(n0, n1, 1);
    assert(isDeleted(graph.serialize().edges[index]));
    graph.addEdge(n0, n1, 1);
    assert(graph.serialize().edges[index] > 0);
    assert(!isDeleted(graph.serialize().edges[index]));
  });

  it('clone should make a new copy', () => {
    let graph = new AdjacencyList({nodeCapacity: 2, edgeCapacity: 5});
    let n0 = graph.addNode();
    let n1 = graph.addNode();
    graph.addEdge(n0, n1, 1);
    graph.addEdge(n0, n1, 2);

    let originalSerialized = graph.serialize();

    let copy = graph.clone();
    let copySerialized = copy.serialize();

    assert(copySerialized.nodes !== originalSerialized.nodes);
    assert(copySerialized.edges !== originalSerialized.edges);
    copySerialized.nodes[0] = Math.max(copySerialized.nodes[0], 1) * 2;
    copySerialized.edges[0] = Math.max(copySerialized.edges[0], 1) * 2;
    assert(copySerialized.nodes[0] !== originalSerialized.nodes[0]);
    assert(copySerialized.edges[0] !== originalSerialized.edges[0]);
  });

  describe('serialize', function() {
    this.timeout(10000);

    it('should share the underlying data across worker threads', async () => {
      let graph = new AdjacencyList({nodeCapacity: 2, edgeCapacity: 5});
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      graph.addEdge(n0, n1, 1);
      graph.addEdge(n0, n1, 2);

      let worker = new Worker(path.join(__dirname, 'integration/worker.js'));

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
        assert.equal(v * 2, received.serialize().nodes[i]);
        assert.equal(v * 2, graph.serialize().nodes[i]);
      });

      originalEdges.forEach((v, i) => {
        assert.equal(v * 2, received.serialize().edges[i]);
        assert.equal(v * 2, graph.serialize().edges[i]);
      });
    });
  });

  describe('deserialize', function() {
    it('should make a readonly AdjacencyList', () => {
      let graph = new AdjacencyList({nodeCapacity: 2, edgeCapacity: 5});
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      graph.addEdge(n0, n1, 1);
      graph.addEdge(n0, n1, 2);
      let edge1 = graph.hash(n0, n1, 1);
      let edge2 = graph.hash(n0, n1, 2);

      let copy = AdjacencyList.deserialize(graph.serialize());

      assert.throws(() => copy.addNode(), /readonly/);
      assert.throws(() => copy.addEdge(n0, n1, 1), /readonly/);
      assert.throws(() => copy.addEdge(n0, n1, 3), /readonly/);
      assert.throws(() => copy.removeEdge(n0, n1, 1), /readonly/);
      assert.throws(() => copy.removeEdge(n0, n1, 3), /readonly/);
      assert.throws(() => copy.resizeNodes(10), /readonly/);
      assert.throws(() => copy.resizeEdges(10), /readonly/);
      assert.throws(() => copy.setEdge(3, n0, null), /readonly/);
      assert.throws(() => copy.linkEdge(3, edge1, edge2), /readonly/);
      assert.throws(() => copy.unlinkEdge(3, null, edge1, null), /readonly/);
    });

    it('should allow a mutable AdjacencyList', () => {
      let graph = new AdjacencyList({nodeCapacity: 2, edgeCapacity: 5});
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      graph.addEdge(n0, n1, 1);
      graph.addEdge(n0, n1, 2);
      let edge1 = graph.hash(n0, n1, 1);
      let edge2 = graph.hash(n0, n1, 2);

      let copy = AdjacencyList.deserialize(graph.serialize(), true);

      assert.doesNotThrow(() => copy.addNode());
      assert.doesNotThrow(() => copy.addEdge(n0, n1, 1));
      assert.doesNotThrow(() => copy.addEdge(n0, n1, 3));
      assert.doesNotThrow(() => copy.removeEdge(n0, n1, 1));
      assert.doesNotThrow(() => copy.removeEdge(n0, n1, 3));
      assert.doesNotThrow(() => copy.resizeNodes(10));
      assert.doesNotThrow(() => copy.resizeEdges(10));
      assert.doesNotThrow(() => copy.setEdge(3, n0, null));
      assert.doesNotThrow(() => copy.linkEdge(3, edge1, edge2));
      assert.doesNotThrow(() => copy.unlinkEdge(3, null, edge1, null));
    });
  });
});

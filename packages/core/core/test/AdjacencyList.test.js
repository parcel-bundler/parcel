// @flow strict-local

import assert from 'assert';

import AdjacencyList, {
  Edge,
  Node,
  NODE_SIZE,
  EDGE_SIZE,
  isDeleted,
} from '../src/AdjacencyList';
import {toNodeId, fromNodeId} from '../src/types';

describe('AdjacencyList', () => {
  it('constructor should initialize an empty graph', () => {
    let graph = new AdjacencyList(1, 1);
    assert.deepEqual(graph.nodes, new Uint32Array(1 * NODE_SIZE));
    assert.deepEqual(graph.edges, new Uint32Array(1 * EDGE_SIZE));
    assert.equal(graph.numNodes, 0);
    assert.equal(graph.numEdges, 0);
  });

  it('addNode should add a node to the graph', () => {
    let graph = new AdjacencyList();
    let id = graph.addNode();
    assert.equal(id, 0);
    assert.equal(graph.numNodes, 1);
  });

  it('addNode should resize nodes array when necessary', () => {
    let graph = new AdjacencyList(1);
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

    assert.deepEqual([...graph.getNodesConnectedTo(node1)], [0, 2, 3, 4, 5, 6]);

    graph.removeEdge(node3, node1);
    assert.deepEqual([...graph.getNodesConnectedTo(node1)], [0, 2, 4, 5, 6]);
  });

  it('removeEdge should remove an edge of a specific type from the graph', () => {
    let graph = new AdjacencyList(2, 5);
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
    assert.deepEqual(Array.from(graph.getAllEdges()), [
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
    assert.deepEqual(Array.from(graph.getAllEdges()), [
      {from: a, to: b, type: 1},
      {from: a, to: b, type: 3},
      {from: a, to: c, type: 1},
      {from: a, to: d, type: 3},
    ]);
  });

  it('addEdge should add an edge to the graph', () => {
    let graph = new AdjacencyList(2, 1);
    let a = graph.addNode();
    let b = graph.addNode();
    graph.addEdge(a, b);
    assert.equal(graph.numNodes, 2);
    assert.equal(graph.numEdges, 1);
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
    assert.deepEqual([...graph.getNodesConnectedFrom(a)], [b, d, c]);
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
    assert.deepEqual([...graph.getNodesConnectedTo(b)], [a, d, c]);
  });

  it('addEdge should add multiple edges of different types in order', () => {
    let graph = new AdjacencyList();
    let a = graph.addNode();
    let b = graph.addNode();
    graph.addEdge(a, b);
    graph.addEdge(a, b, 1);
    graph.addEdge(a, b, 4);
    graph.addEdge(a, b, 3);
    assert.deepEqual([...graph.getNodesConnectedFrom(a)], [b]);
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
    let graph = new AdjacencyList(2, 1);
    let a = graph.addNode();
    let b = graph.addNode();
    let c = graph.addNode();
    assert.equal(graph.edges.length, EDGE_SIZE);
    graph.addEdge(a, b);
    assert.equal(graph.edges.length, EDGE_SIZE * 2);
    graph.addEdge(a, c);
    assert.equal(graph.edges.length, EDGE_SIZE * 4);
  });

  it('addEdge should error when a node has not been added to the graph', () => {
    let graph = new AdjacencyList(2, 1);
    assert.throws(() => graph.addEdge(toNodeId(0), toNodeId(1)));
    graph.addNode();
    assert.throws(() => graph.addEdge(toNodeId(0), toNodeId(1)));
    graph.addNode();
    assert.doesNotThrow(() => graph.addEdge(toNodeId(0), toNodeId(1)));
    assert.throws(() => graph.addEdge(toNodeId(0), toNodeId(2)));
  });

  it('addEdge should error when an unsupported edge type is provided', () => {
    let graph = new AdjacencyList(2, 1);
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
    assert(graph.edges[index] > 0);
    assert(!isDeleted(graph.edges[index]));
    graph.removeEdge(n0, n1, 1);
    assert(isDeleted(graph.edges[index]));
    graph.addEdge(n1, n2, 1);
    assert(isDeleted(graph.edges[index]));
    assert(graph.numEdges === 1);
  });

  it('addEdge should replace a deleted edge', () => {
    let graph = new AdjacencyList();
    let n0 = graph.addNode();
    let n1 = graph.addNode();
    graph.addEdge(n0, n1, 1);
    let index = graph.indexOf(n0, n1, 1);
    assert(graph.edges[index] > 0);
    assert(!isDeleted(graph.edges[index]));
    graph.removeEdge(n0, n1, 1);
    assert(isDeleted(graph.edges[index]));
    graph.addEdge(n0, n1, 1);
    assert(graph.edges[index] > 0);
    assert(!isDeleted(graph.edges[index]));
  });

  describe('Node', () => {
    it('should create a view on data in nodes array', () => {
      let graph = new AdjacencyList();
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      graph.addEdge(n0, n1, 2);

      let index = graph.indexOf(n0, n1, 2);
      let node0 = Node.at(fromNodeId(n0) * NODE_SIZE, graph);
      let node1 = Node.at(fromNodeId(n1) * NODE_SIZE, graph);
      assert.equal(node0.firstOutgoingEdge?.index, index);
      assert.equal(node0.firstIncomingEdge?.index, undefined);
      assert.equal(node0.lastOutgoingEdge?.index, index);
      assert.equal(node0.lastIncomingEdge?.index, undefined);

      assert.equal(node1.firstOutgoingEdge?.index, undefined);
      assert.equal(node1.firstIncomingEdge?.index, index);
      assert.equal(node1.lastOutgoingEdge?.index, undefined);
      assert.equal(node1.lastIncomingEdge?.index, index);

      graph.addEdge(n0, n1, 3);
      let index2 = graph.indexOf(n0, n1, 3);

      assert.equal(node0.firstOutgoingEdge?.index, index);
      assert.equal(node0.firstIncomingEdge?.index, undefined);
      assert.equal(node0.lastOutgoingEdge?.index, index2);
      assert.equal(node0.lastIncomingEdge?.index, undefined);

      assert.equal(node1.firstOutgoingEdge?.index, undefined);
      assert.equal(node1.firstIncomingEdge?.index, index);
      assert.equal(node1.lastOutgoingEdge?.index, undefined);
      assert.equal(node1.lastIncomingEdge?.index, index2);
    });

    it('fromId should return a new Node view when list has resized', () => {
      let graph = new AdjacencyList();
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      graph.addEdge(n0, n1, 2);
      let node0 = Node.fromId(n0, graph);
      let node1 = Node.fromId(n1, graph);
      graph.resizeEdges(graph.edgeCapacity * 2);
      assert(node0 !== Node.fromId(n0, graph));
      assert(node1 !== Node.fromId(n1, graph));
    });

    it('firstOutgoingEdge should return the first outgoing edge from the node', () => {
      let graph = new AdjacencyList();
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      let n2 = graph.addNode();
      graph.addEdge(n0, n1);
      graph.addEdge(n0, n2);
      graph.addEdge(n0, n1, 2);

      let node0 = Node.fromId(n0, graph);
      let edge1 = Edge.at(graph.indexOf(n0, n1), graph);
      assert.equal(edge1.hash, node0.firstOutgoingEdge?.hash);
    });

    it('lastOutgoingEdge should return the last outgoing edge from the node', () => {
      let graph = new AdjacencyList();
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      let n2 = graph.addNode();
      graph.addEdge(n0, n1);
      graph.addEdge(n0, n2);
      graph.addEdge(n0, n1, 2);

      let node0 = Node.fromId(n0, graph);
      let edge3 = Edge.at(graph.indexOf(n0, n1, 2), graph);
      assert.equal(edge3.hash, node0.lastOutgoingEdge?.hash);
    });

    it('firstIncomingEdge should return the first incoming edge from the node', () => {
      let graph = new AdjacencyList();
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      let n2 = graph.addNode();
      graph.addEdge(n0, n1);
      graph.addEdge(n0, n2);
      graph.addEdge(n0, n1, 2);

      let node1 = Node.fromId(n1, graph);
      let edge1 = Edge.at(graph.indexOf(n0, n1), graph);
      assert.equal(edge1.hash, node1.firstIncomingEdge?.hash);
    });

    it('lastIncomingEdge should return the last incoming edge from the node', () => {
      let graph = new AdjacencyList();
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      let n2 = graph.addNode();
      graph.addEdge(n0, n1);
      graph.addEdge(n0, n2);
      graph.addEdge(n0, n1, 2);

      let node1 = Node.fromId(n1, graph);
      let edge1 = Edge.at(graph.indexOf(n0, n1, 2), graph);
      assert.equal(edge1.hash, node1.lastIncomingEdge?.hash);
    });
  });

  describe('Edge', () => {
    it('should create a view on data in edges array', () => {
      let graph = new AdjacencyList();
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      graph.addEdge(n0, n1, 2);

      let index = graph.indexOf(n0, n1, 2);
      let edge = Edge.at(index, graph);
      assert.equal(edge.index, index);
      assert.equal(edge.type, 2);
      assert.equal(edge.from.id, 0);
      assert.equal(edge.to.id, 1);
    });

    it('fromHash should return a new Edge view when list has resized', () => {
      let graph = new AdjacencyList();
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      graph.addEdge(n0, n1, 2);
      let hash = graph.hash(n0, n1, 2);
      let edge = Edge.fromHash(hash, graph);
      graph.resizeEdges(graph.edgeCapacity * 2);
      assert(edge !== Edge.fromHash(hash, graph));
    });

    it('nextOutgoingEdge should return the next outgoing edge from the node', () => {
      let graph = new AdjacencyList();
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      let n2 = graph.addNode();
      graph.addEdge(n0, n1);
      graph.addEdge(n0, n2);
      graph.addEdge(n0, n1, 2);

      let edge1 = Edge.at(graph.indexOf(n0, n1), graph);
      let edge2 = Edge.at(graph.indexOf(n0, n2), graph);
      let edge3 = Edge.at(graph.indexOf(n0, n1, 2), graph);

      assert.equal(edge1.nextOutgoingEdge?.hash, edge2.hash);
      assert.equal(edge1.nextOutgoingEdge?.nextOutgoingEdge?.hash, edge3.hash);
      assert.equal(
        edge1.nextOutgoingEdge?.nextOutgoingEdge?.nextOutgoingEdge?.hash,
        undefined,
      );

      assert.equal(edge2.nextOutgoingEdge?.hash, edge3.hash);
      assert.equal(edge2.nextOutgoingEdge?.nextOutgoingEdge?.hash, undefined);

      assert.equal(edge3.nextOutgoingEdge?.hash, undefined);
    });

    it('nextIncomingEdge should return the next incoming edge to the node', () => {
      let graph = new AdjacencyList();
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      let n2 = graph.addNode();
      graph.addEdge(n0, n1);
      graph.addEdge(n0, n2);
      graph.addEdge(n0, n1, 2);

      let edge1 = Edge.at(graph.indexOf(n0, n1), graph);
      let edge2 = Edge.at(graph.indexOf(n0, n2), graph);
      let edge3 = Edge.at(graph.indexOf(n0, n1, 2), graph);

      assert.equal(edge1.nextIncomingEdge?.hash, edge3.hash);
      assert.equal(edge1.nextIncomingEdge?.nextIncomingEdge?.hash, undefined);

      assert.equal(edge2.nextIncomingEdge?.hash, undefined);

      assert.equal(edge3.nextIncomingEdge?.hash, undefined);
    });

    it('previousOutgoingEdge should return the previous outgoing edge from the node', () => {
      let graph = new AdjacencyList();
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      let n2 = graph.addNode();
      graph.addEdge(n0, n1);
      graph.addEdge(n0, n2);
      graph.addEdge(n0, n1, 2);

      let edge1 = Edge.at(graph.indexOf(n0, n1), graph);
      let edge2 = Edge.at(graph.indexOf(n0, n2), graph);
      let edge3 = Edge.at(graph.indexOf(n0, n1, 2), graph);

      assert.equal(edge3.previousOutgoingEdge?.hash, edge2.hash);
      assert.equal(
        edge3.previousOutgoingEdge?.previousOutgoingEdge?.hash,
        edge1.hash,
      );
      assert.equal(
        edge3.previousOutgoingEdge?.previousOutgoingEdge?.previousOutgoingEdge
          ?.hash,
        undefined,
      );

      assert.equal(edge2.previousOutgoingEdge?.hash, edge1.hash);
      assert.equal(
        edge2.previousOutgoingEdge?.previousOutgoingEdge?.hash,
        undefined,
      );

      assert.equal(edge1.previousOutgoingEdge?.hash, undefined);
    });

    it('previousIncomingEdge should return the previous incoming edge to the node', () => {
      let graph = new AdjacencyList();
      let n0 = graph.addNode();
      let n1 = graph.addNode();
      let n2 = graph.addNode();
      graph.addEdge(n0, n1);
      graph.addEdge(n0, n2);
      graph.addEdge(n0, n1, 2);

      let edge1 = Edge.at(graph.indexOf(n0, n1), graph);
      let edge2 = Edge.at(graph.indexOf(n0, n2), graph);
      let edge3 = Edge.at(graph.indexOf(n0, n1, 2), graph);

      assert.equal(edge1.previousIncomingEdge?.hash, undefined);

      assert.equal(edge2.previousIncomingEdge?.hash, undefined);

      assert.equal(edge3.previousIncomingEdge?.hash, edge1.hash);
      assert.equal(
        edge3.previousIncomingEdge?.previousIncomingEdge?.hash,
        undefined,
      );
    });
  });
});

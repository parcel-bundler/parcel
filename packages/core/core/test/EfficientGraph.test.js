// @flow strict-local

import assert from 'assert';

import EfficientGraph, {NODE_SIZE, EDGE_SIZE} from '../src/EfficientGraph';
import {toNodeId} from '../src/types';
import fs from 'fs';

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

  it.only('resize test', () => {
    let graph = new EfficientGraph(5, 5);
    for (let i = 0; i < 20; i++) {
      graph.addNode();
    }

    graph.addEdge(2, 12);
    graph.addEdge(9, 17);
    graph.addEdge(0, 13);
    graph.addEdge(12, 14);
    graph.addEdge(18, 4);
    graph.addEdge(11, 9);
    graph.addEdge(8, 9);
    graph.addEdge(18, 8);
    graph.addEdge(5, 8);
    graph.addEdge(19, 13);
    graph.addEdge(7, 8);
    graph.addEdge(3, 10);
    graph.addEdge(10, 0);
    graph.addEdge(2, 19);
    graph.addEdge(11, 12);
    graph.addEdge(17, 3);
    graph.addEdge(3, 18);
    graph.addEdge(19, 17);
    graph.addEdge(15, 4);
    graph.addEdge(12, 1);
    graph.addEdge(11, 0);
    graph.addEdge(6, 17);
    graph.addEdge(14, 2);
    graph.addEdge(15, 8);
    graph.addEdge(13, 1);
    graph.addEdge(2, 6);
    graph.addEdge(7, 9);
    graph.addEdge(19, 8);
    graph.addEdge(6, 3);
    // resize here
    graph.addEdge(9, 2);
    graph.addEdge(13, 6);
    graph.addEdge(11, 8);
    graph.addEdge(0, 15);
    graph.addEdge(7, 16);
    graph.addEdge(13, 19);
    graph.addEdge(18, 3);
    graph.addEdge(4, 17);
    graph.addEdge(0, 12);
    graph.addEdge(7, 17);
    graph.addEdge(16, 10);
    graph.addEdge(7, 12);
    graph.addEdge(6, 9);
    graph.addEdge(1, 5);
    graph.addEdge(3, 5);
    graph.addEdge(4, 19);
    graph.addEdge(0, 8);
    graph.addEdge(18, 17);
    graph.addEdge(12, 9);
    graph.addEdge(1, 10);
    // this edge gets lost somehow
    graph.addEdge(18, 19);
    //
    // graph.addEdge(12, 6);
    // graph.addEdge(19, 15);
    // graph.addEdge(14, 3);
    graph.addEdge(18, 16);
    // graph.addEdge(8, 13);
    // graph.addEdge(16, 7);
    // graph.addEdge(14, 6);
    // resize here
    // graph.addEdge(9, 4);
    // graph.addEdge(11, 3);
    // graph.addEdge(3, 16);
    // graph.addEdge(5, 17);
    // graph.addEdge(2, 4);
    // graph.addEdge(14, 5);
    // graph.addEdge(15, 12);
    // graph.addEdge(9, 14);
    // graph.addEdge(11, 7);
    // graph.addEdge(1, 16);
    // graph.addEdge(13, 0);
    // graph.addEdge(6, 12);
    // graph.addEdge(8, 11);
    // graph.addEdge(5, 2);
    // graph.addEdge(4, 9);
    // graph.addEdge(11, 14);
    // graph.addEdge(17, 7);
    // graph.addEdge(8, 19);
    // graph.addEdge(6, 16);
    // graph.addEdge(7, 15);
    // graph.addEdge(14, 13);
    // graph.addEdge(10, 6);
    // graph.addEdge(4, 3);
    // graph.addEdge(13, 18);
    // graph.addEdge(8, 4);
    // graph.addEdge(13, 4);
    // graph.addEdge(5, 11);
    // graph.addEdge(10, 4);
    // graph.addEdge(3, 8);
    // graph.addEdge(18, 12);

    console.log('\nTEST');
    console.log('indexOf {from: 18, to: 19}', graph.indexOf(18, 19, 1));
    console.log('getAllEdges', graph.getAllEdges());
    console.log('getNodesConnectedFrom', [...graph.getNodesConnectedFrom(18)]);
    console.log('hasEdge', graph.hasEdge(18, 19, 1));
    console.log('edge', {
      from: 18,
      to: 19,
      type: 1,
      nextIn: graph.edges[graph.indexOf(18, 19, 1) + 4],
      nextOut: graph.edges[graph.indexOf(18, 19, 1) + 5],
    });
    assert([...graph.getNodesConnectedFrom(18)].includes(19));
  });

  // creates a graph with a bunch of random edges.
  // keep running the test until it fails to have a reproduction of the error.
  // the file with the edges needed to reproduce the error are saved to the root
  // of the repo
  it.skip('create random edges', async () => {
    let graph = new EfficientGraph(5, 5);

    // add some nodes
    let nodes = [];
    for (let i = 0; i < 20; i++) {
      let node = graph.addNode();
      nodes.push(node);
    }

    // add a bunch of random edges
    let edges = [];
    for (let i = 0; i < 5; i++) {
      let random = nodes
        .map(a => ({sort: Math.random(), value: a}))
        .sort((a, b) => a.sort - b.sort)
        .map(a => a.value);

      for (let i = 0; i < random.length; i++) {
        let node = 0;
        let next = 0;

        while (node == next) {
          node = random[Math.floor(Math.random() * graph.numNodes)];
          next = random[Math.floor(Math.random() * graph.numNodes)];
        }

        if (!graph.hasEdge(node, next)) {
          graph.addEdge(node, next);

          // keep track of edges in insertion order
          edges.push({
            from: node,
            to: next,
            type: 1,
          });
        }
      }
    }

    for (let edge of edges) {
      let index = graph.indexOf(edge.from, edge.to, edge.type);
      if (index == -1) {
        // this shouldn't happen
        throw new Error('Edge already added to the graph');
      }
      edge.index = index;
    }

    let unsorted = [...edges];
    // sort to more easily compare
    edges.sort((a, b) => a.index - b.index);
    let allEdges = [...graph.getAllEdges()];
    allEdges.sort((a, b) => a.index - b.index);
    try {
      assert.deepEqual(edges, allEdges);
    } catch (error) {
      await fs.writeFile(
        `edges-${Date.now()}.js`,
        `let unsorted = ${JSON.stringify(unsorted)};\
          let edges = ${JSON.stringify(edges)};\
          let allEdges = ${JSON.stringify(allEdges)};`,
        err => {
          if (err) throw err;
          console.log('The file has been saved!');
        },
      );
      throw new Error(error);
    }
  });
});

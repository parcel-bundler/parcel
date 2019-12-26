// @flow

import assert from 'assert';
import sinon from 'sinon';

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

  it("errors when removeNode is called with a node that doesn't belong", () => {
    let graph = new Graph();
    assert.throws(() => {
      graph.removeNode({id: 'dne', value: null});
    }, /Does not have node/);
  });

  it('errors when traversing a graph with no root', () => {
    let graph = new Graph();

    assert.throws(() => {
      graph.traverse(() => {});
    }, /A start node is required to traverse/);
  });

  it("errors when traversing a graph with a startNode that doesn't belong", () => {
    let graph = new Graph();

    assert.throws(() => {
      graph.traverse(() => {}, {id: 'dne', value: null});
    }, /Does not have node/);
  });

  it("errors if replaceNodesConnectedTo is called with a node that doesn't belong", () => {
    let graph = new Graph();
    assert.throws(() => {
      graph.replaceNodesConnectedTo({id: 'dne', value: null}, []);
    }, /Does not have node/);
  });

  it("errors when adding an edge to a node that doesn't exist", () => {
    let graph = new Graph();
    graph.addNode({id: 'foo', value: null});
    assert.throws(() => {
      graph.addEdge('foo', 'dne');
    }, /"to" node 'dne' not found/);
  });

  it("errors when adding an edge from a node that doesn't exist", () => {
    let graph = new Graph();
    graph.addNode({id: 'foo', value: null});
    assert.throws(() => {
      graph.addEdge('dne', 'foo');
    }, /"from" node 'dne' not found/);
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
    graph.addNode({id: 'a', value: null});
    graph.addNode({id: 'b', value: null});
    graph.addEdge('a', 'b');
    assert(graph.hasEdge('a', 'b'));
  });

  it('isOrphanedNode should return true or false if the node is orphaned or not', () => {
    let graph = new Graph();
    let nodeA = {id: 'a', value: 'a'};
    let nodeB = {id: 'b', value: 'b'};
    let nodeC = {id: 'c', value: 'c'};
    graph.addNode(nodeA);
    graph.addNode(nodeB);
    graph.addNode(nodeC);
    graph.addEdge('a', 'b');
    graph.addEdge('a', 'c', 'edgetype');
    assert(graph.isOrphanedNode(nodeA));
    assert(!graph.isOrphanedNode(nodeB));
    assert(!graph.isOrphanedNode(nodeC));
  });

  it('removeEdge should prune the graph at that edge', () => {
    //         a
    //        / \
    //       b - d
    //      /
    //     c
    let graph = new Graph();
    graph.addNode({id: 'a', value: 'a'});
    graph.addNode({id: 'b', value: 'b'});
    graph.addNode({id: 'c', value: 'c'});
    graph.addNode({id: 'd', value: 'd'});
    graph.addEdge('a', 'b');
    graph.addEdge('a', 'd');
    graph.addEdge('b', 'c');
    graph.addEdge('b', 'd');

    graph.removeEdge('a', 'b');
    assert(graph.nodes.has('a'));
    assert(graph.nodes.has('d'));
    assert(!graph.nodes.has('b'));
    assert(!graph.nodes.has('c'));
    assert.deepEqual(graph.getAllEdges(), [{from: 'a', to: 'd', type: null}]);
  });

  it('removing a node recursively deletes orphaned nodes', () => {
    // before:
    //       a
    //      / \
    //     b   c
    //    / \    \
    //   d   e    f
    //  /
    // g
    //

    // after:
    //      a
    //       \
    //        c
    //         \
    //          f

    let graph = new Graph();
    graph.addNode({id: 'a', value: 'a'});
    graph.addNode({id: 'b', value: 'b'});
    graph.addNode({id: 'c', value: 'c'});
    graph.addNode({id: 'd', value: 'd'});
    graph.addNode({id: 'e', value: 'e'});
    graph.addNode({id: 'f', value: 'f'});
    graph.addNode({id: 'g', value: 'g'});

    graph.addEdge('a', 'b');
    graph.addEdge('a', 'c');
    graph.addEdge('b', 'd');
    graph.addEdge('b', 'e');
    graph.addEdge('c', 'f');
    graph.addEdge('d', 'g');

    graph.removeById('b');

    assert.deepEqual(
      [...graph.nodes.values()].map(node => node.id),
      ['a', 'c', 'f'],
    );
    assert.deepEqual(graph.getAllEdges(), [
      {from: 'a', to: 'c', type: null},
      {from: 'c', to: 'f', type: null},
    ]);
  });

  it('removing a node recursively deletes orphaned nodes if there is no path to the root', () => {
    // before:
    //       a
    //      / \
    //     b   c
    //    / \    \
    // |-d   e    f
    // |/
    // g
    //

    // after:
    //      a
    //       \
    //        c
    //         \
    //          f

    let graph = new Graph();
    graph.setRootNode({id: 'a', value: 'a'});
    graph.addNode({id: 'b', value: 'b'});
    graph.addNode({id: 'c', value: 'c'});
    graph.addNode({id: 'd', value: 'd'});
    graph.addNode({id: 'e', value: 'e'});
    graph.addNode({id: 'f', value: 'f'});
    graph.addNode({id: 'g', value: 'g'});

    graph.addEdge('a', 'b');
    graph.addEdge('a', 'c');
    graph.addEdge('b', 'd');
    graph.addEdge('g', 'd');
    graph.addEdge('b', 'e');
    graph.addEdge('c', 'f');
    graph.addEdge('d', 'g');

    graph.removeById('b');

    assert.deepEqual(
      [...graph.nodes.values()].map(node => node.id),
      ['a', 'c', 'f'],
    );
    assert.deepEqual(graph.getAllEdges(), [
      {from: 'a', to: 'c', type: null},
      {from: 'c', to: 'f', type: null},
    ]);
  });

  it('removing an edge to a node that cycles does not remove it if there is a path to the root', () => {
    //        a
    //        |
    //        b <----
    //       / \    |
    //      c   d   |
    //       \ /    |
    //        e -----
    let graph = new Graph();
    graph.setRootNode({id: 'a', value: 'a'});
    graph.addNode({id: 'b', value: 'b'});
    graph.addNode({id: 'c', value: 'c'});
    graph.addNode({id: 'd', value: 'd'});
    graph.addNode({id: 'e', value: 'e'});

    graph.addEdge('a', 'b');
    graph.addEdge('b', 'c');
    graph.addEdge('b', 'd');
    graph.addEdge('c', 'e');
    graph.addEdge('d', 'e');
    graph.addEdge('e', 'b');

    const getNodeIds = () => [...graph.nodes.values()].map(node => node.id);
    let nodesBefore = getNodeIds();

    graph.removeEdge('c', 'e');

    assert.deepEqual(nodesBefore, getNodeIds());
    assert.deepEqual(graph.getAllEdges(), [
      {from: 'a', to: 'b', type: null},
      {from: 'b', to: 'c', type: null},
      {from: 'b', to: 'd', type: null},
      {from: 'd', to: 'e', type: null},
      {from: 'e', to: 'b', type: null},
    ]);
  });

  it('removing a node with only one inbound edge does not cause it to be removed as an orphan', () => {
    let graph = new Graph();

    graph.setRootNode({id: 'a', value: 'a'});
    graph.addNode({id: 'b', value: 'b'});
    graph.addEdge('a', 'b');

    let spy = sinon.spy(graph, 'removeNode');
    try {
      graph.removeById('b');

      assert(spy.calledOnceWithExactly({id: 'b', value: 'b'}));
    } finally {
      spy.restore();
    }
  });

  it("replaceNodesConnectedTo should update a node's downstream nodes", () => {
    let graph = new Graph();
    let nodeA = graph.addNode({id: 'a', value: 'a'});
    let nodeB = graph.addNode({id: 'b', value: 'b'});
    graph.addNode({id: 'c', value: 'c'});
    graph.addEdge('a', 'b');
    graph.addEdge('a', 'c');

    let nodeD = {id: 'd', value: 'd'};
    graph.replaceNodesConnectedTo(nodeA, [nodeB, nodeD]);

    assert(graph.nodes.has('a'));
    assert(graph.nodes.has('b'));
    assert(!graph.nodes.has('c'));
    assert(graph.nodes.has('d'));
    assert.deepEqual(graph.getAllEdges(), [
      {from: 'a', to: 'b', type: null},
      {from: 'a', to: 'd', type: null},
    ]);
  });

  it('traverses along edge types if a filter is given', () => {
    let graph = new Graph();
    graph.addNode({id: 'a', value: 'a'});
    graph.addNode({id: 'b', value: 'b'});
    graph.addNode({id: 'c', value: 'c'});
    graph.addNode({id: 'd', value: 'd'});

    graph.addEdge('a', 'b', 'edgetype');
    graph.addEdge('a', 'd');
    graph.addEdge('b', 'c');
    graph.addEdge('b', 'd', 'edgetype');

    graph.rootNodeId = 'a';

    let visited = [];
    graph.traverse(
      node => {
        visited.push(node.id);
      },
      null, // use root as startNode
      'edgetype',
    );
    assert.deepEqual(visited, ['a', 'b', 'd']);
  });
});

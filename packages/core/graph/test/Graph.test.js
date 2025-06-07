// @flow strict-local

import assert from 'assert';
import sinon from 'sinon';
import type {TraversalActions} from '@parcel/types-internal';

import Graph from '../src/Graph';
import {toNodeId, type NodeId} from '../src/types';

describe('Graph', () => {
  it('constructor should initialize an empty graph', () => {
    let graph = new Graph();
    assert.deepEqual(graph.nodes, []);
    assert.deepEqual([...graph.getAllEdges()], []);
  });

  it('addNode should add a node to the graph', () => {
    let graph = new Graph();
    let node = {};
    let id = graph.addNode(node);
    assert.equal(graph.getNode(id), node);
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
      graph.traverse(() => {}, toNodeId(-1));
    }, /Does not have node/);
  });

  it("errors if replaceNodeIdsConnectedTo is called with a node that doesn't belong", () => {
    let graph = new Graph();
    assert.throws(() => {
      graph.replaceNodeIdsConnectedTo(toNodeId(-1), []);
    }, /Does not have node/);
  });

  it("errors when adding an edge to a node that doesn't exist", () => {
    let graph = new Graph();
    let node = graph.addNode({});
    assert.throws(() => {
      graph.addEdge(node, toNodeId(-1));
    }, /"to" node '-1' not found/);
  });

  it("errors when adding an edge from a node that doesn't exist", () => {
    let graph = new Graph();
    let node = graph.addNode({});
    assert.throws(() => {
      graph.addEdge(toNodeId(-1), node);
    }, /"from" node '-1' not found/);
  });

  it('hasNode should return a boolean based on whether the node exists in the graph', () => {
    let graph = new Graph();
    let node = graph.addNode({});
    assert(graph.hasNode(node));
    assert(!graph.hasNode(toNodeId(-1)));
  });

  it('addEdge should add an edge to the graph', () => {
    let graph = new Graph();
    let nodeA = graph.addNode('a');
    let nodeB = graph.addNode('b');
    graph.addEdge(nodeA, nodeB);
    assert(graph.hasEdge(nodeA, nodeB));
  });

  it('isOrphanedNode should return true or false if the node is orphaned or not', () => {
    let graph = new Graph();
    let rootNode = graph.addNode('root');
    graph.setRootNodeId(rootNode);

    let nodeA = graph.addNode('a');
    let nodeB = graph.addNode('b');
    let nodeC = graph.addNode('c');
    graph.addEdge(rootNode, nodeB);
    graph.addEdge(nodeB, nodeC, 1);
    assert(graph.isOrphanedNode(nodeA));
    assert(!graph.isOrphanedNode(nodeB));
    assert(!graph.isOrphanedNode(nodeC));
  });

  it("removeEdge should throw if the edge doesn't exist", () => {
    let graph = new Graph();
    let nodeA = graph.addNode('a');
    let nodeB = graph.addNode('b');

    assert.throws(() => {
      graph.removeEdge(nodeA, nodeB);
    }, /Edge from 0 to 1 not found!/);
  });

  it('removeEdge should prune the graph at that edge', () => {
    //         a
    //        / \
    //       b - d
    //      /
    //     c
    let graph = new Graph();
    let nodeA = graph.addNode('a');
    graph.setRootNodeId(nodeA);
    let nodeB = graph.addNode('b');
    let nodeC = graph.addNode('c');
    let nodeD = graph.addNode('d');
    graph.addEdge(nodeA, nodeB);
    graph.addEdge(nodeA, nodeD);
    graph.addEdge(nodeB, nodeC);
    graph.addEdge(nodeB, nodeD);

    graph.removeEdge(nodeA, nodeB);
    assert(graph.hasNode(nodeA));
    assert(graph.hasNode(nodeD));
    assert(!graph.hasNode(nodeB));
    assert(!graph.hasNode(nodeC));
    assert.deepEqual(
      [...graph.getAllEdges()],
      [{from: nodeA, to: nodeD, type: 1}],
    );
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
    let nodeA = graph.addNode('a');
    graph.setRootNodeId(nodeA);
    let nodeB = graph.addNode('b');
    let nodeC = graph.addNode('c');
    let nodeD = graph.addNode('d');
    let nodeE = graph.addNode('e');
    let nodeF = graph.addNode('f');
    let nodeG = graph.addNode('g');

    graph.addEdge(nodeA, nodeB);
    graph.addEdge(nodeA, nodeC);
    graph.addEdge(nodeB, nodeD);
    graph.addEdge(nodeB, nodeE);
    graph.addEdge(nodeC, nodeF);
    graph.addEdge(nodeD, nodeG);

    graph.removeNode(nodeB);

    assert.deepEqual(graph.nodes.filter(Boolean), ['a', 'c', 'f']);
    assert.deepEqual(Array.from(graph.getAllEdges()), [
      {from: nodeA, to: nodeC, type: 1},
      {from: nodeC, to: nodeF, type: 1},
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
    let nodeA = graph.addNode('a');
    let nodeB = graph.addNode('b');
    let nodeC = graph.addNode('c');
    let nodeD = graph.addNode('d');
    let nodeE = graph.addNode('e');
    let nodeF = graph.addNode('f');
    let nodeG = graph.addNode('g');
    graph.setRootNodeId(nodeA);

    graph.addEdge(nodeA, nodeB);
    graph.addEdge(nodeA, nodeC);
    graph.addEdge(nodeB, nodeD);
    graph.addEdge(nodeG, nodeD);
    graph.addEdge(nodeB, nodeE);
    graph.addEdge(nodeC, nodeF);
    graph.addEdge(nodeD, nodeG);

    graph.removeNode(nodeB);

    assert.deepEqual(graph.nodes.filter(Boolean), ['a', 'c', 'f']);
    assert.deepEqual(Array.from(graph.getAllEdges()), [
      {from: nodeA, to: nodeC, type: 1},
      {from: nodeC, to: nodeF, type: 1},
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
    let nodeA = graph.addNode('a');
    let nodeB = graph.addNode('b');
    let nodeC = graph.addNode('c');
    let nodeD = graph.addNode('d');
    let nodeE = graph.addNode('e');
    graph.setRootNodeId(nodeA);

    graph.addEdge(nodeA, nodeB);
    graph.addEdge(nodeB, nodeC);
    graph.addEdge(nodeB, nodeD);
    graph.addEdge(nodeC, nodeE);
    graph.addEdge(nodeD, nodeE);
    graph.addEdge(nodeE, nodeB);

    const getNodeIds = () => [...graph.nodes.keys()];
    let nodesBefore = getNodeIds();

    graph.removeEdge(nodeC, nodeE);

    assert.deepEqual(nodesBefore, getNodeIds());
    assert.deepEqual(Array.from(graph.getAllEdges()), [
      {from: nodeA, to: nodeB, type: 1},
      {from: nodeB, to: nodeC, type: 1},
      {from: nodeB, to: nodeD, type: 1},
      {from: nodeD, to: nodeE, type: 1},
      {from: nodeE, to: nodeB, type: 1},
    ]);
  });

  it('removing a node with only one inbound edge does not cause it to be removed as an orphan', () => {
    let graph = new Graph();

    let nodeA = graph.addNode('a');
    let nodeB = graph.addNode('b');
    graph.setRootNodeId(nodeA);

    graph.addEdge(nodeA, nodeB);

    let spy = sinon.spy(graph, 'removeNode');
    try {
      graph.removeNode(nodeB);

      assert(spy.calledOnceWithExactly(nodeB));
    } finally {
      spy.restore();
    }
  });

  it("replaceNodeIdsConnectedTo should update a node's downstream nodes", () => {
    let graph = new Graph();
    let nodeA = graph.addNode('a');
    graph.setRootNodeId(nodeA);
    let nodeB = graph.addNode('b');
    let nodeC = graph.addNode('c');
    graph.addEdge(nodeA, nodeB);
    graph.addEdge(nodeA, nodeC);

    let nodeD = graph.addNode('d');
    graph.replaceNodeIdsConnectedTo(nodeA, [nodeB, nodeD]);

    assert(graph.hasNode(nodeA));
    assert(graph.hasNode(nodeB));
    assert(!graph.hasNode(nodeC));
    assert(graph.hasNode(nodeD));
    assert.deepEqual(Array.from(graph.getAllEdges()), [
      {from: nodeA, to: nodeB, type: 1},
      {from: nodeA, to: nodeD, type: 1},
    ]);
  });

  it('traverses along edge types if a filter is given', () => {
    let graph = new Graph();
    let nodeA = graph.addNode('a');
    let nodeB = graph.addNode('b');
    let nodeC = graph.addNode('c');
    let nodeD = graph.addNode('d');

    graph.addEdge(nodeA, nodeB, 2);
    graph.addEdge(nodeA, nodeD);
    graph.addEdge(nodeB, nodeC);
    graph.addEdge(nodeB, nodeD, 2);

    graph.setRootNodeId(nodeA);

    let visited = [];
    graph.traverse(
      nodeId => {
        visited.push(nodeId);
      },
      null, // use root as startNode
      2,
    );

    assert.deepEqual(visited, [nodeA, nodeB, nodeD]);
  });

  it('correctly removes non-tree subgraphs', () => {
    let graph = new Graph();
    let nodeRoot = graph.addNode('root');
    let node1 = graph.addNode('1');
    let node2 = graph.addNode('2');
    let node3 = graph.addNode('3');

    graph.addEdge(nodeRoot, node1);
    graph.addEdge(node1, node2);
    graph.addEdge(node1, node3);
    graph.addEdge(node2, node3);

    graph.setRootNodeId(nodeRoot);

    graph.removeNode(node1);

    assert.deepEqual(graph.nodes.filter(Boolean), ['root']);
    assert.deepStrictEqual(Array.from(graph.getAllEdges()), []);
  });

  describe('dfs(...)', () => {
    it(`throws if the graph is empty`, () => {
      const graph = new Graph();
      const visit = sinon.stub();
      const getChildren = sinon.stub();
      assert.throws(() => {
        graph.dfs({
          visit,
          startNodeId: 0,
          getChildren,
        });
      }, /Does not have node 0/);
    });

    it(`visits a single node`, () => {
      const graph = new Graph();
      graph.addNode('root');
      const visit = sinon.stub();
      const getChildren = () => [];
      graph.dfs({
        visit,
        startNodeId: 0,
        getChildren,
      });

      assert(visit.calledOnce);
    });

    it(`visits all connected nodes in DFS order`, () => {
      const graph = new Graph();
      graph.addNode('0');
      graph.addNode('1');
      graph.addNode('2');
      graph.addNode('3');
      graph.addNode('disconnected-1');
      graph.addNode('disconnected-2');
      graph.addEdge(0, 1);
      graph.addEdge(0, 2);
      graph.addEdge(1, 3);
      graph.addEdge(2, 3);

      const order = [];
      const visit = (node: NodeId) => {
        order.push(node);
      };
      const getChildren = (node: NodeId) => graph.getNodeIdsConnectedFrom(node);
      graph.dfs({
        visit,
        startNodeId: 0,
        getChildren,
      });

      assert.deepEqual(order, [0, 1, 3, 2]);
    });

    describe(`actions tests`, () => {
      it(`skips children if skip is called on a node`, () => {
        const graph = new Graph();
        graph.addNode('0');
        graph.addNode('1');
        graph.addNode('2');
        graph.addNode('3');
        graph.addNode('disconnected-1');
        graph.addNode('disconnected-2');
        graph.addEdge(0, 1);
        graph.addEdge(1, 2);
        graph.addEdge(0, 3);

        const order = [];
        const visit = (
          node: NodeId,
          context: mixed | null,
          actions: TraversalActions,
        ) => {
          if (node === 1) actions.skipChildren();
          order.push(node);
        };
        const getChildren = (node: NodeId) =>
          graph.getNodeIdsConnectedFrom(node);
        graph.dfs({
          visit,
          startNodeId: 0,
          getChildren,
        });

        assert.deepEqual(order, [0, 1, 3]);
      });

      it(`stops the traversal if stop is called`, () => {
        const graph = new Graph();
        graph.addNode('0');
        graph.addNode('1');
        graph.addNode('2');
        graph.addNode('3');
        graph.addNode('disconnected-1');
        graph.addNode('disconnected-2');
        graph.addEdge(0, 1);
        graph.addEdge(1, 2);
        graph.addEdge(1, 3);
        graph.addEdge(0, 2);
        graph.addEdge(2, 3);

        const order = [];
        const visit = (
          node: NodeId,
          context: mixed | null,
          actions: TraversalActions,
        ) => {
          order.push(node);
          if (node === 1) {
            actions.stop();
            return 'result';
          }
          return 'other';
        };
        const getChildren = (node: NodeId) =>
          graph.getNodeIdsConnectedFrom(node);
        const result = graph.dfs({
          visit,
          startNodeId: 0,
          getChildren,
        });

        assert.deepEqual(order, [0, 1]);
        assert.equal(result, 'result');
      });
    });

    describe(`context tests`, () => {
      it(`passes the context between visitors`, () => {
        const graph = new Graph();
        graph.addNode('0');
        graph.addNode('1');
        graph.addNode('2');
        graph.addNode('3');
        graph.addNode('disconnected-1');
        graph.addNode('disconnected-2');
        graph.addEdge(0, 1);
        graph.addEdge(1, 2);
        graph.addEdge(1, 3);
        graph.addEdge(0, 2);
        graph.addEdge(2, 3);

        const contexts = [];
        const visit = (node: NodeId, context: mixed | null) => {
          contexts.push([node, context]);
          return `node-${node}-created-context`;
        };
        const getChildren = (node: NodeId) =>
          graph.getNodeIdsConnectedFrom(node);
        const result = graph.dfs({
          visit,
          startNodeId: 0,
          getChildren,
        });

        assert.deepEqual(contexts, [
          [0, null],
          [1, 'node-0-created-context'],
          [2, 'node-1-created-context'],
          [3, 'node-2-created-context'],
        ]);
        assert.equal(result, undefined);
      });
    });

    describe(`exit visitor tests`, () => {
      it(`calls the exit visitor`, () => {
        const graph = new Graph();
        graph.addNode('0');
        graph.addNode('1');
        graph.addNode('2');
        graph.addNode('3');
        graph.addNode('disconnected-1');
        graph.addNode('disconnected-2');
        graph.addEdge(0, 1);
        graph.addEdge(1, 2);
        graph.addEdge(1, 3);
        graph.addEdge(0, 2);

        const contexts = [];
        const visit = (node: NodeId, context: mixed | null) => {
          contexts.push([node, context]);
          return `node-${node}-created-context`;
        };
        const visitExit = (node: NodeId, context: mixed | null) => {
          contexts.push(['exit', node, context]);
          return `node-exit-${node}-created-context`;
        };
        const getChildren = (node: NodeId) =>
          graph.getNodeIdsConnectedFrom(node);
        const result = graph.dfs({
          visit: {
            enter: visit,
            exit: visitExit,
          },
          startNodeId: 0,
          getChildren,
        });

        assert.deepEqual(contexts, [
          [0, null],
          [1, 'node-0-created-context'],
          [2, 'node-1-created-context'],
          ['exit', 2, 'node-2-created-context'],
          [3, 'node-1-created-context'],
          ['exit', 3, 'node-3-created-context'],
          ['exit', 1, 'node-1-created-context'],
          ['exit', 0, 'node-0-created-context'],
        ]);
        assert.equal(result, undefined);
      });
    });
  });
});

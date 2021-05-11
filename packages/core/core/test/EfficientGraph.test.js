// @flow strict-local

import assert from 'assert';
import sinon from 'sinon';

import EfficientGraph, {
  ALL_EDGE_TYPES,
  NODE_SIZE,
  EDGE_SIZE,
} from '../src/EfficientGraph';
import {toNodeId} from '../src/types';

describe.only('EfficientGraph', () => {
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

  // TODO: test 'addNode should resize nodes as needed'

  // it("errors when removeNode is called with a node that doesn't belong", () => {
  //   let graph = new EfficientGraph();
  //   assert.throws(() => {
  //     graph.removeNode(toNodeId(-1));
  //   }, /Does not have node/);
  // });

  // it('errors when traversing a graph with no root', () => {
  //   let graph = new EfficientGraph();

  //   assert.throws(() => {
  //     graph.traverse(() => {});
  //   }, /A start node is required to traverse/);
  // });

  // it("errors when traversing a graph with a startNode that doesn't belong", () => {
  //   let graph = new EfficientGraph();

  //   assert.throws(() => {
  //     graph.traverse(() => {}, toNodeId(-1));
  //   }, /Does not have node/);
  // });

  // it("errors if replaceNodeIdsConnectedTo is called with a node that doesn't belong", () => {
  //   let graph = new EfficientGraph();
  //   assert.throws(() => {
  //     graph.replaceNodeIdsConnectedTo(toNodeId(-1), []);
  //   }, /Does not have node/);
  // });

  // it("errors when adding an edge to a node that doesn't exist", () => {
  //   let graph = new EfficientGraph();
  //   let node = graph.addNode();
  //   assert.throws(() => {
  //     graph.addEdge(node, toNodeId(-1));
  //   }, /"to" node '-1' not found/);
  // });

  // it("errors when adding an edge from a node that doesn't exist", () => {
  //   let graph = new EfficientGraph();
  //   let node = graph.addNode();
  //   assert.throws(() => {
  //     graph.addEdge(toNodeId(-1), node);
  //   }, /"from" node '-1' not found/);
  // });

  // it('addEdge will resize if needed', () => {
  //   let graph = new EfficientGraph();
  //   for (let i = 0; i < 2048; i++) {
  //     graph.addNode();
  //     graph.addEdge(toNodeId(i), toNodeId(i + 1), i + 2);
  //   }

  //   assert.deepEqual(
  //     [...graph.getNodesConnectedFrom(toNodeId(1574), 1576)],
  //     [1575],
  //   );
  // });

  // it('hasNode should return a boolean based on whether the node exists in the graph', () => {
  //   let graph = new EfficientGraph();
  //   let node = graph.addNode();
  //   assert(graph.hasNode(node));
  //   assert(!graph.hasNode(toNodeId(-1)));
  // });

  it('getAllEdges returns all edges', () => {
    let graph = new EfficientGraph();
    graph.addEdge(toNodeId(1), toNodeId(2), 2);
    graph.addEdge(toNodeId(1), toNodeId(2), 3);
    graph.addEdge(toNodeId(4), toNodeId(5));
    assert.deepEqual(
      [...graph.getAllEdges()],
      [
        {from: 1, to: 2, type: 2},
        {from: 1, to: 2, type: 3},
        {from: 4, to: 5, type: 1},
      ],
    );
  });

  it('addEdge should add an edge to the graph', () => {
    let graph = new EfficientGraph();
    let nodeA = graph.addNode();
    let nodeB = graph.addNode();
    assert(graph.addEdge(nodeA, nodeB));
    assert(graph.hasEdge(nodeA, nodeB));
  });

  it('hasEdge should return true for existing edges', () => {
    let graph = new EfficientGraph();
    graph.addEdge(toNodeId(2), toNodeId(3), 2);
    assert(
      graph.hasEdge(
        toNodeId(2),
        toNodeId(3),
        // $FlowFixMe
        ALL_EDGE_TYPES,
      ),
    );
    assert(graph.hasEdge(toNodeId(2), toNodeId(3), 2));
  });

  it('hasEdge should return false for nonexistent edges', () => {
    let graph = new EfficientGraph();
    graph.addEdge(toNodeId(2), toNodeId(3), 2);
    assert(!graph.hasEdge(toNodeId(3), toNodeId(2)));
    assert(!graph.hasEdge(toNodeId(2), toNodeId(3), 3));
  });

  it('getNodesConnectedFrom returns correct node ids', () => {
    let graph = new EfficientGraph();
    graph.addEdge(toNodeId(2), toNodeId(3));
    graph.addEdge(toNodeId(2), toNodeId(4), 2);
    graph.addEdge(toNodeId(2), toNodeId(5), 3);
    graph.addEdge(toNodeId(3), toNodeId(4));

    // should only return nodes connected from 2 with edge type 2
    assert.deepEqual([...graph.getNodesConnectedFrom(toNodeId(2), 2)], [4]);
    // should return all nodes connected from 2 with edge type of 1
    assert.deepEqual([...graph.getNodesConnectedFrom(toNodeId(2))], [3]);
    // should return all nodes connected from 2
    assert.deepEqual(
      // $FlowFixMe
      [...graph.getNodesConnectedFrom(toNodeId(2), ALL_EDGE_TYPES)],
      [5, 4, 3],
    );
  });

  it('getNodesConnectedFrom returns correct node ids with multiple edge types', () => {
    let graph = new EfficientGraph();
    graph.addEdge(toNodeId(2), toNodeId(3), 2);
    graph.addEdge(toNodeId(2), toNodeId(4), 3);
    graph.addEdge(toNodeId(2), toNodeId(5), 4);

    assert.deepEqual([...graph.getNodesConnectedFrom(toNodeId(2), [3])], [4]);
    assert.deepEqual(
      [...graph.getNodesConnectedFrom(toNodeId(2), [2, 3])],
      [4, 3],
    );
    assert.deepEqual(
      [...graph.getNodesConnectedFrom(toNodeId(2), [2, 3, 4])],
      [5, 4, 3],
    );
  });

  it('getNodesConnectedTo returns correct node ids', () => {
    let graph = new EfficientGraph();
    graph.addEdge(toNodeId(1), toNodeId(4), 6);
    graph.addEdge(toNodeId(2), toNodeId(3), 2);
    graph.addEdge(toNodeId(2), toNodeId(3), 3);
    graph.addEdge(toNodeId(2), toNodeId(4));
    graph.addEdge(toNodeId(3), toNodeId(4), 2);

    // should only return nodes connected to 4 with edge type 2
    assert.deepEqual([...graph.getNodesConnectedTo(toNodeId(4), 2)], [3]);
    // should return all nodes connected to 4 with edge type of 1
    assert.deepEqual([...graph.getNodesConnectedTo(toNodeId(4))], [2]);
    // should return all nodes connected to 4
    assert.deepEqual(
      // $FlowFixMe
      [...graph.getNodesConnectedTo(toNodeId(4), ALL_EDGE_TYPES)],
      [3, 2, 1],
    );
  });

  it('getNodesConnectedTo returns correct node ids with multiple edge types', () => {
    let graph = new EfficientGraph();
    graph.addEdge(toNodeId(1), toNodeId(5), 2);
    graph.addEdge(toNodeId(2), toNodeId(5), 3);
    graph.addEdge(toNodeId(3), toNodeId(5), 4);

    assert.deepEqual([...graph.getNodesConnectedTo(toNodeId(5), [3])], [2]);
    assert.deepEqual(
      [...graph.getNodesConnectedTo(toNodeId(5), [2, 3])],
      [2, 1],
    );
    assert.deepEqual(
      [...graph.getNodesConnectedTo(toNodeId(5), [2, 3, 4])],
      [3, 2, 1],
    );
  });
  // it('isOrphanedNode should return true or false if the node is orphaned or not', () => {
  //   let graph = new EfficientGraph();
  //   let nodeA = graph.addNode({id: 'a', type: 'mynode', value: 'a'});
  //   let nodeB = graph.addNode({id: 'b', type: 'mynode', value: 'b'});
  //   let nodeC = graph.addNode({id: 'c', type: 'mynode', value: 'c'});
  //   graph.addEdge(nodeA, nodeB);
  //   graph.addEdge(nodeA, nodeC, 1);
  //   assert(graph._isOrphanedNode(nodeA));
  //   assert(!graph._isOrphanedNode(nodeB));
  //   assert(!graph._isOrphanedNode(nodeC));
  // });

  // it('removeEdge should prune the graph at that edge', () => {
  //   //         a
  //   //        / \
  //   //       b - d
  //   //      /
  //   //     c
  //   let graph = new EfficientGraph();
  //   let nodeA = graph.addNode({id: 'a', type: 'mynode', value: 'a'});
  //   let nodeB = graph.addNode({id: 'b', type: 'mynode', value: 'b'});
  //   let nodeC = graph.addNode({id: 'c', type: 'mynode', value: 'c'});
  //   let nodeD = graph.addNode({id: 'd', type: 'mynode', value: 'd'});
  //   graph.addEdge(nodeA, nodeB);
  //   graph.addEdge(nodeA, nodeD);
  //   graph.addEdge(nodeB, nodeC);
  //   graph.addEdge(nodeB, nodeD);

  //   graph.removeEdge(nodeA, nodeB);
  //   assert(graph.nodes.has(nodeA));
  //   assert(graph.nodes.has(nodeD));
  //   assert(!graph.nodes.has(nodeB));
  //   assert(!graph.nodes.has(nodeC));
  //   assert.deepEqual(graph.getAllEdges(), [{from: nodeA, to: nodeD, type: 0}]);
  // });

  // it('removing a node recursively deletes orphaned nodes', () => {
  //   // before:
  //   //       a
  //   //      / \
  //   //     b   c
  //   //    / \    \
  //   //   d   e    f
  //   //  /
  //   // g
  //   //

  //   // after:
  //   //      a
  //   //       \
  //   //        c
  //   //         \
  //   //          f

  //   let graph = new EfficientGraph();
  //   let nodeA = graph.addNode({id: 'a', type: 'mynode', value: 'a'});
  //   let nodeB = graph.addNode({id: 'b', type: 'mynode', value: 'b'});
  //   let nodeC = graph.addNode({id: 'c', type: 'mynode', value: 'c'});
  //   let nodeD = graph.addNode({id: 'd', type: 'mynode', value: 'd'});
  //   let nodeE = graph.addNode({id: 'e', type: 'mynode', value: 'e'});
  //   let nodeF = graph.addNode({id: 'f', type: 'mynode', value: 'f'});
  //   let nodeG = graph.addNode({id: 'g', type: 'mynode', value: 'g'});

  //   graph.addEdge(nodeA, nodeB);
  //   graph.addEdge(nodeA, nodeC);
  //   graph.addEdge(nodeB, nodeD);
  //   graph.addEdge(nodeB, nodeE);
  //   graph.addEdge(nodeC, nodeF);
  //   graph.addEdge(nodeD, nodeG);

  //   graph.removeNode(nodeB);

  //   assert.deepEqual([...graph.nodes.keys()], [nodeA, nodeC, nodeF]);
  //   assert.deepEqual(graph.getAllEdges(), [
  //     {from: nodeA, to: nodeC, type: 0},
  //     {from: nodeC, to: nodeF, type: 0},
  //   ]);
  // });

  // it('removing a node recursively deletes orphaned nodes if there is no path to the root', () => {
  //   // before:
  //   //       a
  //   //      / \
  //   //     b   c
  //   //    / \    \
  //   // |-d   e    f
  //   // |/
  //   // g
  //   //

  //   // after:
  //   //      a
  //   //       \
  //   //        c
  //   //         \
  //   //          f

  //   let graph = new EfficientGraph();
  //   let nodeA = graph.addNode({id: 'a', type: 'mynode', value: 'a'});
  //   let nodeB = graph.addNode({id: 'b', type: 'mynode', value: 'b'});
  //   let nodeC = graph.addNode({id: 'c', type: 'mynode', value: 'c'});
  //   let nodeD = graph.addNode({id: 'd', type: 'mynode', value: 'd'});
  //   let nodeE = graph.addNode({id: 'e', type: 'mynode', value: 'e'});
  //   let nodeF = graph.addNode({id: 'f', type: 'mynode', value: 'f'});
  //   let nodeG = graph.addNode({id: 'g', type: 'mynode', value: 'g'});
  //   graph.rootNodeId = nodeA;

  //   graph.addEdge(nodeA, nodeB);
  //   graph.addEdge(nodeA, nodeC);
  //   graph.addEdge(nodeB, nodeD);
  //   graph.addEdge(nodeG, nodeD);
  //   graph.addEdge(nodeB, nodeE);
  //   graph.addEdge(nodeC, nodeF);
  //   graph.addEdge(nodeD, nodeG);

  //   graph.removeNode(nodeB);

  //   assert.deepEqual([...graph.nodes.keys()], [nodeA, nodeC, nodeF]);
  //   assert.deepEqual(graph.getAllEdges(), [
  //     {from: nodeA, to: nodeC, type: 0},
  //     {from: nodeC, to: nodeF, type: 0},
  //   ]);
  // });

  // it('removing an edge to a node that cycles does not remove it if there is a path to the root', () => {
  //   //        a
  //   //        |
  //   //        b <----
  //   //       / \    |
  //   //      c   d   |
  //   //       \ /    |
  //   //        e -----
  //   let graph = new EfficientGraph();
  //   let nodeA = graph.addNode({id: 'a', type: 'mynode', value: 'a'});
  //   let nodeB = graph.addNode({id: 'b', type: 'mynode', value: 'b'});
  //   let nodeC = graph.addNode({id: 'c', type: 'mynode', value: 'c'});
  //   let nodeD = graph.addNode({id: 'd', type: 'mynode', value: 'd'});
  //   let nodeE = graph.addNode({id: 'e', type: 'mynode', value: 'e'});
  //   graph.rootNodeId = nodeA;

  //   graph.addEdge(nodeA, nodeB);
  //   graph.addEdge(nodeB, nodeC);
  //   graph.addEdge(nodeB, nodeD);
  //   graph.addEdge(nodeC, nodeE);
  //   graph.addEdge(nodeD, nodeE);
  //   graph.addEdge(nodeE, nodeB);

  //   const getNodeIds = () => [...graph.nodes.keys()];
  //   let nodesBefore = getNodeIds();

  //   graph.removeEdge(nodeC, nodeE);

  //   assert.deepEqual(nodesBefore, getNodeIds());
  //   assert.deepEqual(graph.getAllEdges(), [
  //     {from: nodeA, to: nodeB, type: 0},
  //     {from: nodeB, to: nodeC, type: 0},
  //     {from: nodeB, to: nodeD, type: 0},
  //     {from: nodeD, to: nodeE, type: 0},
  //     {from: nodeE, to: nodeB, type: 0},
  //   ]);
  // });

  // it('removing a node with only one inbound edge does not cause it to be removed as an orphan', () => {
  //   let graph = new EfficientGraph();

  //   let nodeA = graph.addNode({id: 'a', type: 'mynode', value: 'a'});
  //   let nodeB = graph.addNode({id: 'b', type: 'mynode', value: 'b'});
  //   graph.rootNodeId = nodeA;

  //   graph.addEdge(nodeA, nodeB);

  //   let spy = sinon.spy(graph, 'removeNode');
  //   try {
  //     graph.removeNode(nodeB);

  //     assert(spy.calledOnceWithExactly(nodeB));
  //   } finally {
  //     spy.restore();
  //   }
  // });

  // it("replaceNodeIdsConnectedTo should update a node's downstream nodes", () => {
  //   let graph = new EfficientGraph();
  //   let nodeA = graph.addNode({id: 'a', type: 'mynode', value: 'a'});
  //   let nodeB = graph.addNode({id: 'b', type: 'mynode', value: 'b'});
  //   let nodeC = graph.addNode({id: 'c', type: 'mynode', value: 'c'});
  //   graph.addEdge(nodeA, nodeB);
  //   graph.addEdge(nodeA, nodeC);

  //   let nodeD = graph.addNode({id: 'd', type: 'mynode', value: 'd'});
  //   graph.replaceNodeIdsConnectedTo(nodeA, [nodeB, nodeD]);

  //   assert(graph.hasNode(nodeA));
  //   assert(graph.hasNode(nodeB));
  //   assert(!graph.hasNode(nodeC));
  //   assert(graph.hasNode(nodeD));
  //   assert.deepEqual(graph.getAllEdges(), [
  //     {from: nodeA, to: nodeB, type: 0},
  //     {from: nodeA, to: nodeD, type: 0},
  //   ]);
  // });

  // it('traverses along edge types if a filter is given', () => {
  //   let graph = new EfficientGraph();
  //   let nodeA = graph.addNode({id: 'a', type: 'mynode', value: 'a'});
  //   let nodeB = graph.addNode({id: 'b', type: 'mynode', value: 'b'});
  //   let nodeC = graph.addNode({id: 'c', type: 'mynode', value: 'c'});
  //   let nodeD = graph.addNode({id: 'd', type: 'mynode', value: 'd'});

  //   graph.addEdge(nodeA, nodeB, 1);
  //   graph.addEdge(nodeA, nodeD);
  //   graph.addEdge(nodeB, nodeC);
  //   graph.addEdge(nodeB, nodeD, 1);

  //   graph.rootNodeId = nodeA;

  //   let visited = [];
  //   graph.traverse(
  //     nodeId => {
  //       visited.push(nodeId);
  //     },
  //     null, // use root as startNode
  //     1,
  //   );

  //   assert.deepEqual(visited, [nodeA, nodeB, nodeD]);
  // });
});

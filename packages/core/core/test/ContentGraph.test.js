// @flow strict-local

import assert from 'assert';

// flowlint-next-line untyped-import:off
import ContentGraph from '../src/ContentGraph';

describe('ContentGraph', () => {
  it('constructor should initialize an empty graph', () => {
    let graph = new ContentGraph();
    assert.deepEqual(graph.nodes, new Map());
    assert.deepEqual(graph.getAllEdges(), []);
  });

  it('addNodeByContentKey should add a node to the graph', () => {
    let graph = new ContentGraph();
    let node = {id: 'doNotUse', type: 'mynode', value: 'a'};
    let nodeId = graph.addNodeByContentKey(node, 'a');
    assert.equal(graph.getNode(nodeId), node);
    assert.equal(graph.contentKeyToNumericId.get('a'), nodeId);
  });

  it('getNodeByContentKey should get a node from the graph', () => {
    let graph = new ContentGraph();
    let node = {id: 'doNotUse', type: 'mynode', value: 'a'};
    let nodeId = graph.addNodeByContentKey(node, 'a');
    assert.equal(graph.getNodeByContentKey('a'), graph.getNode(nodeId));
    assert.equal(graph.contentKeyToNumericId.get('a'), nodeId);
  });
});

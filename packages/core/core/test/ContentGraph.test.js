// @flow strict-local

import assert from 'assert';
import ContentGraph from '../src/ContentGraph';

describe('ContentGraph', () => {
  it('should addNodeByContentKey if no node exists with the content key', () => {
    let graph = new ContentGraph();

    const node = {id: 'contentKey', type: 'mynode', value: ' 1'};

    const nodeId1 = graph.addNodeByContentKey('contentKey', node);

    assert.deepEqual(graph.getNode(nodeId1), node);
    assert(graph.hasContentKey('contentKey'));
    assert.deepEqual(graph.getNodeByContentKey('contentKey'), node);
  });

  it('should update the node through addNodeByContentKey if a node with the content key exists', () => {
    let graph = new ContentGraph();

    const node1 = {id: 'contentKey', value: '1', type: 'mynode'};
    const node2 = {id: 'contentKey', value: '2', type: 'mynode'};

    const nodeId1 = graph.addNodeByContentKey('contentKey', node1);
    const nodeId2 = graph.addNodeByContentKey('contentKey', node2);

    assert.deepEqual(graph.getNode(nodeId1), node1);
    assert(graph.hasContentKey('contentKey'));

    assert.equal(nodeId1, nodeId2);
    assert.deepEqual(graph.getNode(nodeId2), node2);
  });

  it('should remove the content key from graph when node is removed', () => {
    let graph = new ContentGraph();

    const node1 = {id: 'contentKey', value: '1', type: 'mynode'};
    const nodeId1 = graph.addNodeByContentKey('contentKey', node1);

    assert.deepEqual(graph.getNode(nodeId1), node1);
    assert(graph.hasContentKey('contentKey'));

    graph.removeNode(nodeId1);

    assert(!graph.hasContentKey('contentKey'));
  });
});

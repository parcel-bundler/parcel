// @flow strict-local

import Graph, {type GraphOpts} from './Graph';
import type {ContentKey, Node, NodeId} from './types';
import nullthrows from 'nullthrows';

export type SerializedContentGraph<
  TNode: Node,
  TEdgeType: string | null = null,
> = {|
  ...GraphOpts<TNode, TEdgeType>,
  _contentKeyToNodeId: Map<ContentKey, NodeId>,
|};

export default class ContentGraph<
  TNode: Node,
  TEdgeType: string | null = null,
> extends Graph<TNode, TEdgeType> {
  _contentKeyToNodeId: Map<ContentKey, NodeId>;

  constructor(opts: ?SerializedContentGraph<TNode, TEdgeType>) {
    if (opts) {
      let {_contentKeyToNodeId, ...rest} = opts;
      super(rest);
      this._contentKeyToNodeId = _contentKeyToNodeId;
    } else {
      super();
      this._contentKeyToNodeId = new Map();
    }
  }

  // $FlowFixMe[prop-missing]
  static deserialize(
    opts: SerializedContentGraph<TNode, TEdgeType>,
  ): ContentGraph<TNode, TEdgeType> {
    return new ContentGraph(opts);
  }

  // $FlowFixMe[prop-missing]
  serialize(): SerializedContentGraph<TNode, TEdgeType> {
    return {
      ...super.serialize(),
      _contentKeyToNodeId: this._contentKeyToNodeId,
    };
  }

  addNodeByContentKey(contentKey: ContentKey, node: TNode): NodeId {
    if (!this.hasContentKey(contentKey)) {
      let nodeId = super.addNode(node);
      this._contentKeyToNodeId.set(contentKey, nodeId);
      return nodeId;
    } else {
      let existingNodeId = this.getNodeIdByContentKey(contentKey);
      let existingNode = nullthrows(this.getNodeByContentKey(contentKey));
      existingNode.value = node.value;
      this.updateNode(existingNodeId, existingNode);
      return existingNodeId;
    }
  }

  getNodeByContentKey(contentKey: ContentKey): ?TNode {
    let nodeId = this._contentKeyToNodeId.get(contentKey);
    if (nodeId != null) {
      return super.getNode(nodeId);
    }
  }

  getNodeIdByContentKey(contentKey: ContentKey): NodeId {
    return nullthrows(
      this._contentKeyToNodeId.get(contentKey),
      'Expected content key to exist',
    );
  }

  hasContentKey(contentKey: ContentKey): boolean {
    return this._contentKeyToNodeId.has(contentKey);
  }

  removeNode(nodeId: NodeId) {
    this._assertHasNodeId(nodeId);
    this._contentKeyToNodeId.delete(nullthrows(this.getNode(nodeId)).id);
    super.removeNode(nodeId);
  }
}

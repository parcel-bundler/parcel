// @flow strict-local

import Graph, {type GraphOpts} from './Graph';
import type {Node, NodeId} from './types';
import nullthrows from 'nullthrows';

export type SerializedContentGraph<
  TNode: Node,
  TEdgeType: string | null = null,
> = {|
  ...GraphOpts<TNode, TEdgeType>,
  _contentKeyToNodeId: Map<string, NodeId>,
|};

export default class ContentGraph<
  TNode: Node,
  TEdgeType: string | null = null,
> extends Graph<TNode, TEdgeType> {
  _contentKeyToNodeId: Map<string, NodeId>;

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

  addNodeByContentKey(contentKey: string, node: TNode): NodeId {
    let nodeId = super.addNode2(node);
    let fromNode = this.getNodeByContentKey(contentKey);
    if (fromNode != null) {
      super.replaceNode(fromNode, node);
    }
    this._contentKeyToNodeId.set(contentKey, nodeId);
    return nodeId;
  }

  getNodeByContentKey(contentKey: string): ?TNode {
    let nodeId = this._contentKeyToNodeId.get(contentKey);
    if (nodeId != null) {
      return super.getNode(nodeId);
    }
  }

  getNodeIdByContentKey(contentKey: string): NodeId {
    return nullthrows(
      this._contentKeyToNodeId.get(contentKey),
      'Expected content key to exist',
    );
  }
}

// @flow strict-local

import Graph, {type GraphOpts} from './Graph';
import type {Node, NodeId} from './types';

type SerializedContentGraph<TNode: Node, TEdgeType: string | null = null> = {|
  ...GraphOpts<TNode, TEdgeType>,
  contentKeyToNumericId: Map<string, NodeId>,
|};

export default class ContentGraph<TNode: Node> extends Graph<TNode> {
  contentKeyToNumericId: Map<string, NodeId>;

  constructor(opts: ?SerializedContentGraph<TNode>) {
    if (opts) {
      let {contentKeyToNumericId, ...rest} = opts;
      super(rest);
      this.contentKeyToNumericId = contentKeyToNumericId;
    } else {
      super();
      this.contentKeyToNumericId = new Map();
    }
  }

  // $FlowFixMe[prop-missing]
  static deserialize(opts: SerializedContentGraph<TNode>): ContentGraph<TNode> {
    return new ContentGraph(opts);
  }

  // $FlowFixMe[prop-missing]
  serialize(): SerializedContentGraph<TNode> {
    return {
      ...super.serialize(),
      contentKeyToNumericId: this.contentKeyToNumericId,
    };
  }
}

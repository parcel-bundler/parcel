// @flow strict-local

// forcing NodeId to be opaque as it should only be created once
export opaque type NodeId = number;
export type NullEdgeType = 1;
export type AllEdgeTypes = '@@all_edge_types';

export function toNodeId(x: number): NodeId {
  return x;
}
export function fromNodeId(x: NodeId): number {
  return x;
}

export type ContentKey = string;

export type Edge<TEdgeType: number | NullEdgeType> = {|
  from: NodeId,
  to: NodeId,
  type: TEdgeType,
|};

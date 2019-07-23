// @flow strict-local

import type {
  Asset as IAsset,
  GraphTraversalCallback,
  GraphVisitor
} from '@parcel/types';
import type InternalAsset from '../Asset';
import type AssetGraph from '../AssetGraph';

import {Asset} from './Asset';
import invariant from 'assert';

export function getInternalAsset(
  assetGraph: AssetGraph,
  publicAsset: IAsset
): InternalAsset {
  let node = assetGraph.getNode(publicAsset.id);
  invariant(node != null && node.type === 'asset');
  return node.value;
}

export function assetGraphVisitorToInternal<TContext>(
  visit: GraphVisitor<IAsset, TContext>
): GraphVisitor<InternalAsset, TContext> {
  if (typeof visit === 'function') {
    return assetGraphTraversalToInternal(visit);
  }

  return {
    enter: visit.enter ? assetGraphTraversalToInternal(visit.enter) : undefined,
    exit: visit.exit ? assetGraphTraversalToInternal(visit.exit) : undefined
  };
}

function assetGraphTraversalToInternal<TContext>(
  visit: GraphTraversalCallback<IAsset, TContext>
): GraphTraversalCallback<InternalAsset, TContext> {
  return (asset: InternalAsset, context: ?TContext, actions) => {
    return visit(new Asset(asset), context, actions);
  };
}

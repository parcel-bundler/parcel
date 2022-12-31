// @flow

import type {Diagnostic} from '@parcel/diagnostic';
import type {NodeId} from '@parcel/graph';
import type {ParcelOptions} from './types';

import {type Asset} from './types';
import {type default as AssetGraph} from './AssetGraph';
import {AssetGraphBuilder} from './requests/AssetGraphRequest';

export function propagateSymbols({
  options,
  assetGraph,
  changedAssets,
  dependenciesWithRemovedParents,
  previousErrors,
}: {|
  options: ParcelOptions,
  assetGraph: AssetGraph,
  changedAssets: Map<string, Asset>,
  dependenciesWithRemovedParents: Set<NodeId>,
  previousErrors?: ?Map<NodeId, Array<Diagnostic>>,
|}): Map<NodeId, Array<Diagnostic>> {
  // TODO move functions from AssetGraphRequest to here

  let builder = new AssetGraphBuilder({
    input: ({} /*: any */),
    farm: ({} /*: any */),
    invalidateReason: ({} /*: any */),
    // $FlowFixMe
    api: {getInvalidSubRequests: () => []},
    options,
  });
  builder.assetGraph = assetGraph;
  builder.changedAssets = changedAssets;

  return builder.propagateSymbols({
    options: builder.options,
    assetGraph: builder.assetGraph,
    changedAssets: builder.changedAssets,
    dependenciesWithRemovedParents: dependenciesWithRemovedParents,
    previousErrors: previousErrors,
  });
}

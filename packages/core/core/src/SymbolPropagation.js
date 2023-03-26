// @flow

import type {Diagnostic} from '@parcel/diagnostic';
import type {NodeId} from '@parcel/graph';
import type {ParcelOptions} from './types';

import {type default as AssetGraph} from './AssetGraph';
import {AssetGraphBuilder} from './requests/AssetGraphRequest';

export function propagateSymbols({
  options,
  assetGraph,
  changedAssetsPropagation,
  assetGroupsWithRemovedParents,
  previousErrors,
}: {|
  options: ParcelOptions,
  assetGraph: AssetGraph,
  changedAssetsPropagation: Set<string>,
  assetGroupsWithRemovedParents: Set<NodeId>,
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
  builder.changedAssetsPropagation = changedAssetsPropagation;

  return builder.propagateSymbols({
    options: builder.options,
    assetGraph: builder.assetGraph,
    changedAssetsPropagation: builder.changedAssetsPropagation,
    assetGroupsWithRemovedParents: assetGroupsWithRemovedParents,
    previousErrors: previousErrors,
  });
}

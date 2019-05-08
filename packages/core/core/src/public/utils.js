// @flow strict-local

import type {Asset, BundleGroup} from '@parcel/types';
import type InternalAsset from '../Asset';
import type AssetGraph from '../AssetGraph';

import invariant from 'assert';

export const getBundleGroupId = (bundleGroup: BundleGroup) =>
  'bundle_group:' + bundleGroup.entryAssetId;

export function getInternalAsset(
  assetGraph: AssetGraph,
  publicAsset: Asset
): InternalAsset {
  let node = assetGraph.getNode(publicAsset.id);
  invariant(
    node != null && (node.type === 'asset' || node.type === 'asset_reference')
  );
  return node.value;
}

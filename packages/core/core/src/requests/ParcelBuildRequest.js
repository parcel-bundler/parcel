// @flow strict-local
import type {Async, BuildEvent} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type InternalBundleGraph from '../BundleGraph';
import type {StaticRunOpts} from '../RequestTracker';
import type {Asset, AssetGroup} from '../types';

import dumpGraphToGraphViz from '../dumpGraphToGraphViz';
import createAssetGraphRequest from './AssetGraphRequest';
import createBundleGraphRequest from './BundleGraphRequest';

type ParcelBuildInput = {|
  optionsRef: SharedReference,
|};
type RunInput = {|
  input: ParcelBuildInput,
  ...StaticRunOpts<BuildEvent>,
|};
type ParcelBuildRequest = {|
  id: string,
  type: string,
  run: RunInput => Async<{|
    changedAssets: Map<string, Asset>,
    assetRequests: Array<AssetGroup>,
    bundleGraph: InternalBundleGraph,
  |}>,
  input: ParcelBuildInput,
|};

export default function createParcelBuildRequest(
  input: ParcelBuildInput,
): ParcelBuildRequest {
  return {
    id: 'singleton', // ? what should id be?
    type: 'parcel_build_request',
    input,
    run: async ({input, api, options}) => {
      let {assetGraph, changedAssets, assetRequests} = await api.runRequest(
        createAssetGraphRequest({
          name: 'Main',
          entries: options.entries,
          optionsRef: input.optionsRef,
        }),
      );
      dumpGraphToGraphViz(assetGraph, 'MainAssetGraph');

      // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381
      let bundleGraph = await api.runRequest(
        createBundleGraphRequest({assetGraph}),
      );
      // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381 (Windows only)
      dumpGraphToGraphViz(bundleGraph._graph, 'BundleGraph');

      return {changedAssets, assetRequests, bundleGraph};
    },
  };
}

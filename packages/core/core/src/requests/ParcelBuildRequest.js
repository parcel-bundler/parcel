// @flow strict-local

import type {Async} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type {ContentKey} from '@parcel/graph';
import type {AssetAddr} from '@parcel/rust';

import type {StaticRunOpts} from '../RequestTracker';
import type {AssetGroup, PackagedBundleInfo} from '../types';
import type BundleGraph from '../BundleGraph';

import createBundleGraphRequest, {
  type BundleGraphResult,
} from './BundleGraphRequest';
import createWriteBundlesRequest from './WriteBundlesRequest';
import {assertSignalNotAborted} from '../utils';
import dumpGraphToGraphViz from '../dumpGraphToGraphViz';
import {bundleGraphEdgeTypes} from '../BundleGraph';
import {report} from '../ReporterRunner';
import IBundleGraph from '../public/BundleGraph';
import {NamedBundle} from '../public/Bundle';
import {assetFromValue} from '../public/Asset';
import {readCachedString, Asset as DbAsset} from '@parcel/rust';

import {tracer} from '@parcel/profiler';

type ParcelBuildRequestInput = {|
  optionsRef: SharedReference,
  requestedAssetIds: Set<ContentKey>,
  signal?: AbortSignal,
|};

type ParcelBuildRequestResult = {|
  bundleGraph: BundleGraph,
  bundleInfo: Map<string, PackagedBundleInfo>,
  changedAssets: Map<AssetAddr, AssetAddr>,
  assetRequests: Array<AssetGroup>,
|};

type RunInput<TResult> = {|
  input: ParcelBuildRequestInput,
  ...StaticRunOpts<TResult>,
|};

export type ParcelBuildRequest = {|
  id: string,
  +type: 'parcel_build_request',
  run: (RunInput<ParcelBuildRequestResult>) => Async<ParcelBuildRequestResult>,
  input: ParcelBuildRequestInput,
|};

export default function createParcelBuildRequest(
  input: ParcelBuildRequestInput,
): ParcelBuildRequest {
  return {
    type: 'parcel_build_request',
    id: 'parcel_build_request',
    run,
    input,
  };
}

async function run({input, api, options}) {
  let {optionsRef, requestedAssetIds, signal} = input;

  let bundleGraphRequest = createBundleGraphRequest({
    optionsRef,
    requestedAssetIds,
    signal,
  });

  // await api.takeHeapSnapshot('before-bundling');

  let {bundleGraph, changedAssets, assetRequests}: BundleGraphResult =
    await api.runRequest(bundleGraphRequest, {
      force: options.shouldBuildLazily && requestedAssetIds.size > 0,
    });

  // await api.takeHeapSnapshot('after-bundling');

  dumpGraphToGraphViz(
    options.db,
    // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381 (Windows only)
    bundleGraph._graph,
    'BundleGraph',
    bundleGraphEdgeTypes,
  );

  await report({
    type: 'buildProgress',
    phase: 'bundled',
    bundleGraph: new IBundleGraph(
      bundleGraph,
      (bundle, bundleGraph, options) =>
        NamedBundle.get(bundle, bundleGraph, options),
      options,
    ),
    changedAssets: new Map(
      Array.from(changedAssets).map(([id, asset]) => [
        readCachedString(options.db, DbAsset.get(options.db, id).id),
        assetFromValue(asset, options, bundleGraph),
      ]),
    ),
  });

  let packagingMeasurement = tracer.createMeasurement('packaging');
  let writeBundlesRequest = createWriteBundlesRequest({
    bundleGraph,
    optionsRef,
  });

  // await api.takeHeapSnapshot('before-packaging');

  let bundleInfo = await api.runRequest(writeBundlesRequest);

  // await api.takeHeapSnapshot('after-packaging');

  packagingMeasurement && packagingMeasurement.end();
  assertSignalNotAborted(signal);

  return {bundleGraph, bundleInfo, changedAssets, assetRequests};
}

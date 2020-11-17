// @flow strict-local
import type {Async} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type InternalBundleGraph from '../BundleGraph';
import type {StaticRunOpts} from '../RequestTracker';
import type {Asset, AssetGroup} from '../types';

import nullthrows from 'nullthrows';
import dumpGraphToGraphViz from '../dumpGraphToGraphViz';
import PackagerRunner from '../PackagerRunner';
import ParcelConfig from '../ParcelConfig';
import {report} from '../ReporterRunner';
import createAssetGraphRequest from './AssetGraphRequest';
import createBundleGraphRequest from './BundleGraphRequest';
import createParcelConfigRequest from './ParcelConfigRequest';

type ParcelBuildInput = {|
  optionsRef: SharedReference,
|};
type RunInput = {|
  input: ParcelBuildInput,
  ...StaticRunOpts<ParcelBuildResult>,
|};

type ParcelBuildResult = {|
  changedAssets: Map<string, Asset>,
  assetRequests: Array<AssetGroup>,
  bundleGraph: InternalBundleGraph,
|};
type ParcelBuildRequest = {|
  id: string,
  type: string,
  run: RunInput => Async<ParcelBuildResult>,
  input: ParcelBuildInput,
|};

export default function createParcelBuildRequest(
  input: ParcelBuildInput,
): ParcelBuildRequest {
  return {
    id: 'singleton', // ? what should id be?
    type: 'parcel_build_request',
    input,
    run: async ({input, api, options, farm}) => {
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
        createBundleGraphRequest({assetGraph, optionsRef: input.optionsRef}),
      );
      // $FlowFixMe Added in Flow 0.121.0 upgrade in #4381 (Windows only)
      dumpGraphToGraphViz(bundleGraph._graph, 'BundleGraph');

      // TODO: convert to request
      let {config, cachePath} = nullthrows(
        await api.runRequest<null, ConfigAndCachePath>(
          createParcelConfigRequest(),
        ),
      );
      await new PackagerRunner({
        config: new ParcelConfig(
          config,
          options.packageManager,
          options.inputFS,
          options.autoinstall,
        ),
        farm,
        options,
        optionsRef: input.optionsRef,
        configCachePath: cachePath,
        report,
      }).writeBundles(bundleGraph);

      return {changedAssets, assetRequests, bundleGraph};
    },
  };
}

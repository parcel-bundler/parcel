// @flow strict-local

import type {ParcelOptions, AssetRequest} from '@parcel/types';
import type {Bundle, NodeId} from './types';
import type BundleGraph from './BundleGraph';

import Config from './Config';
import TransformerRunner from './TransformerRunner';
import PackagerRunner from './PackagerRunner';
import ParcelConfig from './ParcelConfig';
import registerCoreWithSerializer from './registerCoreWithSerializer';

registerCoreWithSerializer();

export function runTransform({
  config,
  options,
  request,
  loadConfig,
  parentNodeId
}: {
  request: AssetRequest,
  config: ParcelConfig,
  options: ParcelOptions,
  loadConfig: () => Promise<Config>,
  parentNodeId: NodeId
}) {
  return new TransformerRunner({
    config,
    options
  }).transform(request, loadConfig, parentNodeId);
}

export function runPackage({
  bundle,
  bundleGraph,
  config,
  options
}: {
  bundle: Bundle,
  bundleGraph: BundleGraph,
  config: ParcelConfig,
  options: ParcelOptions
}) {
  return new PackagerRunner({
    config,
    options
  }).writeBundle(bundle, bundleGraph);
}

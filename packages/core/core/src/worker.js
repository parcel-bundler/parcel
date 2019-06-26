// @flow strict-local

import type {ParcelOptions, AssetRequest} from '@parcel/types';
import type {Bundle} from './types';
import type BundleGraph from './BundleGraph';

import TransformerRunner from './TransformerRunner';
import PackagerRunner from './PackagerRunner';
import ValidatorRunner from './ValidatorRunner';
import Config from './Config';
import registerCoreWithSerializer from './registerCoreWithSerializer';

registerCoreWithSerializer();

export function runTransform({
  request,
  config,
  options
}: {
  request: AssetRequest,
  config: Config,
  options: ParcelOptions
}) {
  return new TransformerRunner({
    config,
    options
  }).transform(request);
}

export function runValidate({
  request,
  config,
  options
}: {
  request: AssetRequest,
  config: Config,
  options: ParcelOptions
}) {
  return new ValidatorRunner({
    config,
    options
  }).validate(request);
}

export function runPackage({
  bundle,
  bundleGraph,
  config,
  options
}: {
  bundle: Bundle,
  bundleGraph: BundleGraph,
  config: Config,
  options: ParcelOptions
}) {
  return new PackagerRunner({
    config,
    options
  }).writeBundle(bundle, bundleGraph);
}

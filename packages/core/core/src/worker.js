// @flow strict-local

import type {ParcelOptions} from '@parcel/types';
import type {Bundle} from './types';
import type BundleGraph from './BundleGraph';

import {Transformation} from './TransformerRunner';
import type {TransformationOpts} from './TransformerRunner';
import PackagerRunner from './PackagerRunner';
import ParcelConfig from './ParcelConfig';
import registerCoreWithSerializer from './registerCoreWithSerializer';

registerCoreWithSerializer();

export function runTransform(opts: TransformationOpts) {
  return new Transformation(opts).run();
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

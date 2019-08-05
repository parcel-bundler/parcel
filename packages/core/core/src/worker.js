// @flow strict-local

import type {Bundle, ParcelOptions} from './types';
import type BundleGraph from './BundleGraph';

import Transformation, {type TransformationOpts} from './Transformation';
import PackagerRunner from './PackagerRunner';
import Validation, {type ValidationOpts} from './Validation';
import ParcelConfig from './ParcelConfig';
import registerCoreWithSerializer from './registerCoreWithSerializer';

registerCoreWithSerializer();

export function runTransform(opts: TransformationOpts) {
  return new Transformation(opts).run();
}

export function runValidate(opts: ValidationOpts) {
  return new Validation(opts).run();
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

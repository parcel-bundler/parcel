// @flow strict-local
import invariant from 'assert';
import type {Bundle, ParcelOptions} from './types';
import BundleGraph from './BundleGraph';
import type {WorkerApi} from '@parcel/workers';

import Transformation, {type TransformationOpts} from './Transformation';
import PackagerRunner from './PackagerRunner';
import Validation, {type ValidationOpts} from './Validation';
import ParcelConfig from './ParcelConfig';
import registerCoreWithSerializer from './registerCoreWithSerializer';
import '@parcel/cache'; // register with serializer
import '@parcel/package-manager';
import '@parcel/fs';

registerCoreWithSerializer();

// Remove the workerApi type from the TransformationOpts and ValidationOpts types:
// https://github.com/facebook/flow/issues/2835
type RunTransformOpts = $Diff<
  TransformationOpts,
  {|workerApi: mixed, options: ParcelOptions|}
>;
type RunValidateOpts = $Diff<
  ValidationOpts,
  {|workerApi: mixed, options: ParcelOptions|}
>;

export function runTransform(workerApi: WorkerApi, opts: RunTransformOpts) {
  let options: ParcelOptions = workerApi.getSharedReference(opts.optionsRef);
  return new Transformation({workerApi, options, ...opts}).run();
}

export function runValidate(workerApi: WorkerApi, opts: RunValidateOpts) {
  let options: ParcelOptions = workerApi.getSharedReference(opts.optionsRef);
  return new Validation({workerApi, options, ...opts}).run();
}

export function runPackage(
  workerApi: WorkerApi,
  {
    bundle,
    bundleGraphReference,
    configRef,
    cacheKey,
    optionsRef
  }: {
    bundle: Bundle,
    bundleGraphReference: number,
    configRef: number,
    cacheKey: string,
    optionsRef: number,
    ...
  }
) {
  let bundleGraph = workerApi.getSharedReference(bundleGraphReference);
  invariant(bundleGraph instanceof BundleGraph);
  let options: ParcelOptions = workerApi.getSharedReference(optionsRef);
  let config: ParcelConfig = workerApi.getSharedReference(configRef);
  return new PackagerRunner({
    config,
    options
  }).packageAndWriteBundle(bundle, bundleGraph, cacheKey);
}

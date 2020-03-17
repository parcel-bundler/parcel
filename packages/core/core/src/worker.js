// @flow strict-local
import invariant from 'assert';
import type {Bundle, ParcelOptions} from './types';
import BundleGraph from './BundleGraph';
import type {WorkerApi} from '@parcel/workers';

import Transformation, {type TransformationOpts} from './Transformation';
import {reportWorker} from './ReporterRunner';
import PackagerRunner from './PackagerRunner';
import Validation, {type ValidationOpts} from './Validation';
import ParcelConfig from './ParcelConfig';
import {registerCoreWithSerializer} from './utils';

import '@parcel/cache'; // register with serializer
import '@parcel/package-manager';
import '@parcel/fs';

registerCoreWithSerializer();

// Remove the workerApi type from the TransformationOpts and ValidationOpts types:
// https://github.com/facebook/flow/issues/2835
type WorkerTransformationOpts = {|
  ...$Diff<TransformationOpts, {|workerApi: mixed, options: ParcelOptions|}>,
  optionsRef: number,
|};
type WorkerValidationOpts = {|
  ...$Diff<ValidationOpts, {|workerApi: mixed, options: ParcelOptions|}>,
  optionsRef: number,
|};

export function runTransform(
  workerApi: WorkerApi,
  opts: WorkerTransformationOpts,
) {
  let {optionsRef, ...rest} = opts;
  let options = workerApi.getSharedReference(optionsRef);
  return new Transformation({
    workerApi,
    report: reportWorker.bind(null, workerApi),
    // $FlowFixMe
    options,
    ...rest,
  }).run();
}

export function runValidate(workerApi: WorkerApi, opts: WorkerValidationOpts) {
  let {optionsRef, ...rest} = opts;
  let options = workerApi.getSharedReference(optionsRef);
  return new Validation({
    workerApi,
    report: reportWorker.bind(null, workerApi),
    // $FlowFixMe
    options,
    ...rest,
  }).run();
}

export function runPackage(
  workerApi: WorkerApi,
  {
    bundle,
    bundleGraphReference,
    config,
    cacheKeys,
    optionsRef,
  }: {|
    bundle: Bundle,
    bundleGraphReference: number,
    config: ParcelConfig,
    cacheKeys: {|
      content: string,
      map: string,
      info: string,
    |},
    optionsRef: number,
  |},
) {
  let bundleGraph = workerApi.getSharedReference(bundleGraphReference);
  let options = workerApi.getSharedReference(optionsRef);
  invariant(bundleGraph instanceof BundleGraph);
  return new PackagerRunner({
    config,
    // $FlowFixMe
    options,
    report: reportWorker.bind(null, workerApi),
  }).getBundleInfo(bundle, bundleGraph, cacheKeys);
}

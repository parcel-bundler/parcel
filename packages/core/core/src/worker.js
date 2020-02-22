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
type TransformationOptsWithoutWorkerApi = $Diff<
  TransformationOpts,
  {|workerApi: mixed|},
>;
type ValidationOptsWithoutWorkerApi = $Diff<
  ValidationOpts,
  {|workerApi: mixed|},
>;

export function runTransform(
  workerApi: WorkerApi,
  opts: TransformationOptsWithoutWorkerApi,
) {
  return new Transformation({
    workerApi,
    report: reportWorker.bind(null, workerApi),
    ...opts,
  }).run();
}

export function runValidate(
  workerApi: WorkerApi,
  opts: ValidationOptsWithoutWorkerApi,
) {
  return new Validation({
    workerApi,
    report: reportWorker.bind(null, workerApi),
    ...opts,
  }).run();
}

export function runPackage(
  workerApi: WorkerApi,
  {
    bundle,
    bundleGraphReference,
    config,
    cacheKeys,
    options,
  }: {|
    bundle: Bundle,
    bundleGraphReference: number,
    config: ParcelConfig,
    cacheKeys: {|
      content: string,
      map: string,
      info: string,
    |},
    options: ParcelOptions,
  |},
) {
  let bundleGraph = workerApi.getSharedReference(bundleGraphReference);
  invariant(bundleGraph instanceof BundleGraph);
  return new PackagerRunner({
    config,
    options,
    report: reportWorker.bind(null, workerApi),
  }).getBundleInfo(bundle, bundleGraph, cacheKeys);
}

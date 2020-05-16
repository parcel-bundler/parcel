// @flow strict-local
import invariant from 'assert';
import type {Bundle, ParcelOptions, ProcessedParcelConfig} from './types';
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
  configRef: number,
|};
type WorkerValidationOpts = {|
  ...$Diff<ValidationOpts, {|workerApi: mixed, options: ParcelOptions|}>,
  optionsRef: number,
  configRef: number,
|};

export function runTransform(
  workerApi: WorkerApi,
  opts: WorkerTransformationOpts,
) {
  let {optionsRef, configRef, ...rest} = opts;
  let options = ((workerApi.getSharedReference(
    optionsRef,
    // $FlowFixMe
  ): any): ParcelOptions);
  let processedConfig = ((workerApi.getSharedReference(
    configRef,
    // $FlowFixMe
  ): any): ProcessedParcelConfig);
  let config = new ParcelConfig(
    processedConfig,
    options.packageManager,
    options.autoinstall,
  );

  return new Transformation({
    workerApi,
    report: reportWorker.bind(null, workerApi),
    options,
    config,
    ...rest,
  }).run();
}

export function runValidate(workerApi: WorkerApi, opts: WorkerValidationOpts) {
  let {optionsRef, configRef, ...rest} = opts;
  let options = ((workerApi.getSharedReference(
    optionsRef,
    // $FlowFixMe
  ): any): ParcelOptions);
  let processedConfig = ((workerApi.getSharedReference(
    configRef,
    // $FlowFixMe
  ): any): ProcessedParcelConfig);
  let config = new ParcelConfig(
    processedConfig,
    options.packageManager,
    options.autoinstall,
  );

  return new Validation({
    workerApi,
    report: reportWorker.bind(null, workerApi),
    options,
    config,
    ...rest,
  }).run();
}

export function runPackage(
  workerApi: WorkerApi,
  {
    bundle,
    bundleGraphReference,
    configRef,
    cacheKeys,
    optionsRef,
  }: {|
    bundle: Bundle,
    bundleGraphReference: number,
    configRef: number,
    cacheKeys: {|
      content: string,
      map: string,
      info: string,
    |},
    optionsRef: number,
  |},
) {
  let bundleGraph = workerApi.getSharedReference(bundleGraphReference);
  invariant(bundleGraph instanceof BundleGraph);
  let options = ((workerApi.getSharedReference(
    optionsRef,
    // $FlowFixMe
  ): any): ParcelOptions);
  let processedConfig = ((workerApi.getSharedReference(
    configRef,
    // $FlowFixMe
  ): any): ProcessedParcelConfig);
  let config = new ParcelConfig(
    processedConfig,
    options.packageManager,
    options.autoinstall,
  );

  return new PackagerRunner({
    config,
    options,
    report: reportWorker.bind(null, workerApi),
  }).getBundleInfo(bundle, bundleGraph, cacheKeys);
}

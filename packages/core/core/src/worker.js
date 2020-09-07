// @flow strict-local

import type {Bundle, ParcelOptions, ProcessedParcelConfig} from './types';
import type {SharedReference, WorkerApi} from '@parcel/workers';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import BundleGraph from './BundleGraph';
import Transformation, {
  type TransformationOpts,
  type TransformationResult,
} from './Transformation';
import {reportWorker} from './ReporterRunner';
import PackagerRunner, {type BundleInfo} from './PackagerRunner';
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
  optionsRef: SharedReference,
  configCachePath: string,
|};
type WorkerValidationOpts = {|
  ...$Diff<ValidationOpts, {|workerApi: mixed, options: ParcelOptions|}>,
  optionsRef: SharedReference,
  configCachePath: string,
|};

// TODO: this should eventually be replaced by an in memory cache layer
let parcelConfigCache = new Map();

function loadOptions(ref, workerApi) {
  return nullthrows(
    ((workerApi.getSharedReference(
      ref,
      // $FlowFixMe
    ): any): ParcelOptions),
  );
}

async function loadConfig(cachePath, options) {
  let processedConfig =
    parcelConfigCache.get(cachePath) ??
    nullthrows(await options.cache.get(cachePath));
  let config = new ParcelConfig(
    // $FlowFixMe
    ((processedConfig: any): ProcessedParcelConfig),
    options.packageManager,
    options.inputFS,
    options.autoinstall,
  );
  parcelConfigCache.set(cachePath, config);
  return config;
}

export async function runTransform(
  workerApi: WorkerApi,
  opts: WorkerTransformationOpts,
): Promise<TransformationResult> {
  let {optionsRef, configCachePath, ...rest} = opts;
  let options = loadOptions(optionsRef, workerApi);
  let config = await loadConfig(configCachePath, options);

  return new Transformation({
    workerApi,
    report: reportWorker.bind(null, workerApi),
    options,
    config,
    ...rest,
  }).run();
}

export async function runValidate(
  workerApi: WorkerApi,
  opts: WorkerValidationOpts,
): Promise<void> {
  let {optionsRef, configCachePath, ...rest} = opts;
  let options = loadOptions(optionsRef, workerApi);
  let config = await loadConfig(configCachePath, options);

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
    bundleGraphReference: SharedReference,
    configRef: SharedReference,
    cacheKeys: {|
      content: string,
      map: string,
      info: string,
    |},
    optionsRef: SharedReference,
  |},
): Promise<BundleInfo> {
  let bundleGraph = workerApi.getSharedReference(bundleGraphReference);
  invariant(bundleGraph instanceof BundleGraph);
  let options = loadOptions(optionsRef, workerApi);
  let processedConfig = ((workerApi.getSharedReference(
    configRef,
    // $FlowFixMe
  ): any): ProcessedParcelConfig);
  let config = new ParcelConfig(
    processedConfig,
    options.packageManager,
    options.inputFS,
    options.autoinstall,
  );

  return new PackagerRunner({
    config,
    options,
    report: reportWorker.bind(null, workerApi),
  }).getBundleInfo(bundle, bundleGraph, cacheKeys);
}

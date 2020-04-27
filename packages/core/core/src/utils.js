// @flow strict-local

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type {BundleGroup} from '@parcel/types';

import {registerSerializableClass} from './serializer';
import AssetGraph from './AssetGraph';
import BundleGraph from './BundleGraph';
import Graph from './Graph';
import ParcelConfig from './ParcelConfig';
import {RequestGraph} from './RequestTracker';
import Config from './public/Config';
// flowlint-next-line untyped-import:off
import packageJson from '../package.json';

export function getBundleGroupId(bundleGroup: BundleGroup): string {
  return 'bundle_group:' + bundleGroup.entryAssetId;
}

export function assertSignalNotAborted(signal: ?AbortSignal): void {
  if (signal && signal.aborted) {
    throw new BuildAbortError();
  }
}

export class BuildAbortError extends Error {
  name = 'BuildAbortError';
}

let coreRegistered;
export function registerCoreWithSerializer() {
  if (coreRegistered) {
    return;
  }

  const packageVersion: mixed = packageJson.version;
  if (typeof packageVersion !== 'string') {
    throw new Error('Expected package version to be a string');
  }

  // $FlowFixMe
  for (let [name, ctor] of (Object.entries({
    AssetGraph,
    Config,
    BundleGraph,
    Graph,
    ParcelConfig,
    RequestGraph,
  }): Array<[string, Class<*>]>)) {
    registerSerializableClass(packageVersion + ':' + name, ctor);
  }

  coreRegistered = true;
}

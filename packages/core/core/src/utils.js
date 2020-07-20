// @flow strict-local

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type {BundleGroup} from '@parcel/types';

import assert from 'assert';
import baseX from 'base-x';
import {registerSerializableClass} from './serializer';
import AssetGraph from './AssetGraph';
import BundleGraph from './BundleGraph';
import Graph from './Graph';
import ParcelConfig from './ParcelConfig';
import {RequestGraph} from './RequestTracker';
import Config from './public/Config';
// flowlint-next-line untyped-import:off
import packageJson from '../package.json';

const base62 = baseX(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
);

export function getBundleGroupId(bundleGroup: BundleGroup): string {
  return 'bundle_group:' + bundleGroup.entryAssetId;
}

export function assertSignalNotAborted(signal: ?AbortSignal): void {
  if (signal && signal.aborted) {
    throw new BuildAbortError();
  }
}

export class BuildAbortError extends Error {
  name: string = 'BuildAbortError';
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

export function getPublicId(
  id: string,
  alreadyExists: string => boolean,
): string {
  assert(
    id.match(/^[0-9a-f]{32}$/),
    `id ${id} must be a 32-character hexadecimal string`,
  );

  let encoded = base62.encode(Buffer.from(id, 'hex'));
  for (let end = 5; end <= encoded.length; end++) {
    let candidate = encoded.slice(0, end);
    if (!alreadyExists(candidate)) {
      return candidate;
    }
  }

  throw new Error('Original id was not unique');
}

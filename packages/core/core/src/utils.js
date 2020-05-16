// @flow strict-local

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type {BundleGroup} from '@parcel/types';

import assert from 'assert';
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

export function getPublicId(
  id: string,
  alreadyExists: string => boolean,
): string {
  assert(
    id.match(/^[0-9a-f]{32}$/),
    `id ${id} must be a 32-character hexadecimal string`,
  );

  let buf = Buffer.alloc(16);
  for (let byteOffset = 0; byteOffset < 16; byteOffset += 4) {
    // Add the integer values to the buffer
    // https://stackoverflow.com/questions/8044543/how-can-i-store-an-integer-in-a-nodejs-buffer/53550757#53550757
    buf.writeUInt32BE(
      parseInt(id.slice(byteOffset * 2, byteOffset * 2 + 8), 16),
      byteOffset,
    );
  }

  // 128-bit values are represented in the first 22 characters
  // of the base64 string. The remaining two are always '=='.
  let base64 = buf.toString('base64').slice(0, 22);
  for (let end = 5; end <= base64.length; end++) {
    let candidate = base64.slice(0, end);
    if (!alreadyExists(candidate)) {
      return candidate;
    }
  }

  throw new Error('Original id was not unique');
}

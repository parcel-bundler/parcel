// @flow strict-local

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type {BundleGroup} from '@parcel/types';

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

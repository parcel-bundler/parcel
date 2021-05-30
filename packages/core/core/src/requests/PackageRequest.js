// @flow strict-local

import type {Async} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type {StaticRunOpts} from '../RequestTracker';
import type {
  Bundle,
  ContentKey,
  DevDepRequest,
  TransformationRequest,
} from '../types';
import type BundleGraph from '../BundleGraph';
import type {BundleInfo} from '../PackagerRunner';

type PackageRequestInput = {|
  bundleGraph: BundleGraph,
  bundle: Bundle,
  bundleGraphReference: SharedReference,
  configRef: SharedReference,
  optionsRef: SharedReference,
|};

type RunInput = {|
  input: PackageRequestInput,
  ...StaticRunOpts,
|};

export type PackageRequest = {|
  id: ContentKey,
  +type: 'package_request',
  run: RunInput => Async<BundleInfo>,
  input: PackageRequestInput,
|};

export function createPackageRequest(
  input: PackageRequestInput,
): PackageRequest {
  return {
    type: 'package_request',
    id: input.bundleGraph.getHash(input.bundle),
    run,
    input,
  };
}

async function run({input, api, farm, invalidateReason}: RunInput) {
  let {bundleGraphReference, configRef, optionsRef, bundle} = input;
  let runPackage = farm.createHandle('runPackage');

  return await runPackage({
    bundle,
    bundleGraphReference,
    optionsRef,
    configRef,
  });
}

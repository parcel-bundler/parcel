// @flow strict-local

import type {BundleGroup} from '@parcel/types';

export const getBundleGroupId = (bundleGroup: BundleGroup) =>
  'bundle_group:' + bundleGroup.entryAssetId;

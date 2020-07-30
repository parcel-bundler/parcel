// @flow strict-local

// $FlowFixMe
import {version} from '../package.json';

export const PARCEL_VERSION = version;
export const BUNDLE_HASH_REF_PREFIX = 'BUNDLE_HREF_';
export const BUNDLE_HASH_REF_REGEX: RegExp = new RegExp(
  `${BUNDLE_HASH_REF_PREFIX}\\w{32}`,
  'g',
);
export const ASSET_HASH_REF_PREFIX = 'ASSETS_HREF_';
export const ASSET_HASH_REF_REGEX: RegExp = new RegExp(
  `${ASSET_HASH_REF_PREFIX}\\w{32}`,
  'g',
);

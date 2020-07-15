// @flow strict-local

// $FlowFixMe
import {version} from '../package.json';

export const PARCEL_VERSION = version;
export const HASH_REF_PREFIX = 'HASH_REF_';
export const HASH_REF_REGEX: RegExp = new RegExp(
  `${HASH_REF_PREFIX}\\w{32}`,
  'g',
);

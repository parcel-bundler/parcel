// @flow strict-local
import type {ContentKey} from './types';

// TODO: Likely will move

export default class Delta {
  modified: Set<ContentKey> = new Set();
  removed: Set<ContentKey> = new Set();
  added: Set<ContentKey> = new Set();
}

// @flow strict-local
import type {Cache} from '@parcel/types';

// $FlowFixMe
export class IDBCache implements Cache {
  constructor() {
    throw new Error('IDBCache is only supported in the browser');
  }
}

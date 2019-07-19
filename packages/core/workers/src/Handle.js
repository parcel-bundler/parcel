import WorkerFarm from './WorkerFarm';
import packageJson from '../package.json';
import {registerSerializableClass} from '@parcel/utils';

let HANDLE_ID = 0;

export default class Handle {
  constructor(opts) {
    this.id = opts ? opts.id : ++HANDLE_ID;
  }

  static deserialize(opts) {
    return function(...args) {
      return WorkerFarm.callMaster({handle: opts.id, args}, true);
    };
  }
}

// Register the Handle as a serializable class so that it will properly be deserialized
// by anything that uses WorkerFarm.
registerSerializableClass(`${packageJson.version}:Handle`, Handle);

// @flow strict-local
import {registerSerializableClass} from '@parcel/core';
import type {
  Handle as IHandle,
  HandleOpts,
  HandleFunction,
} from '@parcel/types';

// $FlowFixMe
import packageJson from '../package.json';

let HANDLE_ID = 0;
const handleById: Map<number, IHandle> = new Map();

export default class Handle implements IHandle {
  id: number;
  childId: ?number;
  fn: ?HandleFunction;

  constructor(opts: HandleOpts) {
    this.id = opts.id ?? ++HANDLE_ID;
    this.fn = opts.fn;
    this.childId = opts.childId;
    handleById.set(this.id, this);
  }

  dispose() {
    handleById.delete(this.id);
  }

  serialize(): {|childId: ?number, id: number|} {
    return {
      id: this.id,
      childId: this.childId,
    };
  }

  static deserialize(opts: HandleOpts): Handle {
    return new Handle(opts);
  }
}

// Register the Handle as a serializable class so that it will properly be deserialized
// by anything that uses WorkerFarm.
registerSerializableClass(`${packageJson.version}:Handle`, Handle);

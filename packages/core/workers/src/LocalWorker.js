import {serialize, deserialize} from '@parcel/utils/src/serializer';

export default class LocalWorker {
  constructor(workerPath) {
    this.child = require(workerPath);
  }

  init(args) {
    return this.child.init(args);
  }

  call(method, args) {
    return deserialize(this.child[method](serialize(args)));
  }
}

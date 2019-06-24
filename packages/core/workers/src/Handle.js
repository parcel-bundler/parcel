import WorkerFarm from './WorkerFarm';

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

const {EventEmitter} = require('events');
const promisify = require('./utils/promisify');

let shared = null;

class WorkerFarm {
  constructor() {
    this.localWorker = this.promisifyWorker(require('./worker'));
  }

  init(options) {
    this.options = options;
    this.localWorker.init(options);
  }

  promisifyWorker(worker) {
    let res = {};

    for (let key in worker) {
      res[key] = promisify(worker[key].bind(worker));
    }

    return res;
  }

  async run(...args) {
    return this.localWorker.run(...args);
  }

  end() {
    shared = null;
  }

  static getShared(options) {
    if (!shared) {
      shared = new WorkerFarm();
    }
    shared.init(options);

    return shared;
  }
}

for (let key in EventEmitter.prototype) {
  WorkerFarm.prototype[key] = EventEmitter.prototype[key];
}

module.exports = WorkerFarm;

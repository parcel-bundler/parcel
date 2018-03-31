require('v8-compile-cache');
const Pipeline = require('../Pipeline');
const Path = require('path');
const WorkerFarm = require('./WorkerFarm');

const BASEPATH =
  parseInt(process.versions.node, 10) < 8 ? '../../lib/' : '../../src/';

let shared;
class Worker {
  constructor() {
    this.callQueue = [];
    this.responseQueue = new Map();
    this.responseId = 0;
    this.activeCalls = 0;
    this.maxConcurrentCalls = 10;
  }

  init(options) {
    this.pipeline = new Pipeline(options || {});
    Object.assign(process.env, options.env || {});
    process.env.HMR_PORT = options.hmrPort;
    process.env.HMR_HOSTNAME = options.hmrHostname;
  }

  async run(path, pkg, options, isWarmUp) {
    try {
      options.isWarmUp = isWarmUp;
      return await this.pipeline.process(path, pkg, options);
    } catch (e) {
      e.fileName = path;
      throw e;
    }
  }

  setId(childId) {
    this.id = childId;
  }

  // Keep in mind to make sure responses to these calls are JSON.Stringify safe
  async addCall(request) {
    let call = request;
    call.type = 'request';
    call.child = this.id;
    if (request.location) {
      call.location = Path.join(BASEPATH, request.location);
    }
    return new Promise((resolve, reject) => {
      call.resolve = resolve;
      call.reject = reject;
      this.callQueue.push(call);
      this.processQueue();
    });
  }

  async send(call) {
    let idx = this.responseId++;
    this.responseQueue.set(idx, call);
    let ipcPackage = {
      idx: idx,
      child: call.child,
      type: call.type,
      location: call.location,
      method: call.method,
      args: call.args
    };
    this.activeCalls++;
    if (process.send) {
      process.send(ipcPackage, err => {
        if (err instanceof Error) {
          err.message = 'Failed to send IPC Message to master process.';
          throw err;
        }
      });
    } else {
      this.respond(await WorkerFarm.getShared().processRequest(ipcPackage));
    }
  }

  async processQueue() {
    if (!this.callQueue.length) {
      return;
    }

    if (this.activeCalls < this.maxConcurrentCalls) {
      this.send(this.callQueue.shift());
    }
  }

  respond(response) {
    let call = this.responseQueue.get(response.idx);

    if (response.error) {
      let error = new Error(response.error.message);
      Object.keys(response.error).forEach(key => {
        error[key] = response.error[key];
      });
      process.nextTick(() => call.reject(error));
    } else {
      process.nextTick(() => call.resolve(response.result));
    }

    this.responseQueue.delete(response.idx);
    this.activeCalls--;
    // Process the next call
    this.processQueue();
  }

  static getShared() {
    if (!shared) {
      shared = new Worker();
    }
    return shared;
  }
}

module.exports = Worker.getShared();

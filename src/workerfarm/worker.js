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
    this.responseQueue = [];
    this.currentCalls = 0;
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
    let idx = this.callQueue.length;
    let call = request;
    call.type = 'request';
    call.child = this.id;
    if (request.location) {
      call.location = Path.join(BASEPATH, request.location);
    }
    return new Promise((resolve, reject) => {
      call.resolve = resolve;
      call.reject = reject;
      call.idx = idx;
      this.callQueue.push(call);
      this.currentCalls++;
      this.processQueue();
    });
  }

  async send(call) {
    call.idx = this.responseQueue.length;
    this.responseQueue.push(call);
    this.activeCalls++;
    let ipcPackage = {
      idx: call.idx,
      child: call.child,
      type: call.type,
      location: call.location,
      method: call.method,
      args: call.args
    };
    if (process.send) {
      process.send(ipcPackage);
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
    let call = this.responseQueue[response.idx];
    if (response.error) {
      let error = new Error(response.error.message);
      Object.keys(response.error).forEach(key => {
        error[key] = response.error[key];
      });
      process.nextTick(function() {
        call.reject(error);
      });
    } else {
      call.resolve(response.result);
    }
    delete this.responseQueue[response.idx];
    this.currentCalls--;
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

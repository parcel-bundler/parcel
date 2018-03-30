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
    this.callPromises = [];
    this.currentCalls = 0;
    this.maxConcurrentCalls = 10;
  }

  init(options, childId) {
    this.id = childId;
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

  // Keep in mind to make sure responses to these calls are JSON.Stringify safe
  async addCall(request) {
    let idx = this.callQueue.length;
    let call = request;
    call.child = this.id;
    call.idx = idx;
    call.type = 'request';
    if (request.location) {
      call.location = Path.join(BASEPATH, request.location);
    }
    return new Promise((resolve, reject) => {
      this.callQueue.push(call);
      this.callPromises.push({resolve, reject, idx});
      this.processQueue();
    });
  }

  async processQueue() {
    if (!this.callQueue.length) {
      return;
    }

    if (this.currentCalls < this.maxConcurrentCalls) {
      if (process.send) {
        process.send(this.callQueue.shift());
      } else {
        this.respond(
          await WorkerFarm.getShared().processRequest(this.callQueue.shift())
        );
      }

      this.currentCalls++;
    }
  }

  respond(response) {
    let call = this.callPromises[response.idx];
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
    delete this.callPromises[response.idx];
    this.currentCalls--;
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

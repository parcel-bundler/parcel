const {EventEmitter} = require('events');
const os = require('os');
const errorUtils = require('./errorUtils');
const Worker = require('./Worker');

let shared = null;
class WorkerFarm extends EventEmitter {
  constructor(options, farmOptions = {}) {
    super();
    this.options = Object.assign(
      {
        maxConcurrentWorkers: WorkerFarm.getNumWorkers(),
        maxConcurrentCallsPerWorker: 10,
        forcedKillTime: 100,
        warmWorkers: true,
        useLocalWorker: true
      },
      farmOptions
    );

    this.started = false;
    this.warmWorkers = 0;
    this.children = new Map();
    this.callQueue = [];

    this.init(options);
  }

  warmupWorker(location, method, args) {
    // Workers have started, but are not warmed up yet.
    // Send the job to a remote worker in the background,
    // but use the result from the local worker - it will be faster.
    if (this.started) {
      let promise = this.addCall(location, method, [...args, true]);
      if (promise) {
        promise
          .then(() => {
            this.warmWorkers++;
            if (this.warmWorkers >= this.children.size) {
              this.emit('warmedup');
            }
          })
          .catch(() => {});
      }
    }
  }

  mkhandle(location, method) {
    return function(...args) {
      // Child process workers are slow to start (~600ms).
      // While we're waiting, just run on the main thread.
      // This significantly speeds up startup time.
      if (this.shouldUseRemoteWorkers()) {
        return this.addCall(location, method, [...args, false]);
      } else {
        if (this.options.warmWorkers) {
          this.warmupWorker(location, method, args);
        }

        return require(location)[method](...args, false);
      }
    }.bind(this);
  }

  onError(error, childId) {
    // Handle ipc errors
    if (error.code === 'ERR_IPC_CHANNEL_CLOSED') {
      return this.stopChild(childId);
    }
  }

  onExit(childId) {
    // delay this to give any sends a chance to finish
    setTimeout(() => {
      let doQueue = false;
      let child = this.children.get(childId);
      if (child && child.calls.size) {
        for (let call of child.calls.values()) {
          call.retries++;
          this.callQueue.unshift(call);
          doQueue = true;
        }
      }
      this.stopChild(childId);
      if (doQueue) {
        this.processQueue();
      }
    }, 10);
  }

  startChild() {
    let worker = new Worker(this.options, this.workerOptions);

    worker.on('request', data => {
      this.processRequest(data, worker);
    });

    worker.on('response', () => {
      // allow any outstanding calls to be processed
      this.processQueue();
    });

    worker.once('exit', () => {
      this.onExit(worker.id);
    });

    worker.on('error', err => {
      this.onError(err, worker.id);
    });

    this.children.set(worker.id, worker);
  }

  stopChild(childId) {
    let child = this.children.get(childId);
    if (child) {
      child.stop();
      this.children.delete(childId);
    }
  }

  async processQueue() {
    if (this.ending || !this.callQueue.length) return;

    if (this.children.size < this.options.maxConcurrentWorkers) {
      this.startChild();
    }

    for (let child of this.children.values()) {
      if (!this.callQueue.length) {
        break;
      }

      if (child.calls.size < this.options.maxConcurrentCallsPerWorker) {
        child.call(this.callQueue.shift());
      }
    }
  }

  async processRequest(data, child = false) {
    let result = {
      idx: data.idx,
      type: 'response'
    };

    let method = data.method;
    let args = data.args;
    let location = data.location;
    let awaitResponse = data.awaitResponse;

    if (!location) {
      throw new Error('Unknown request');
    }

    const mod = require(location);
    try {
      let func;
      if (method) {
        func = mod[method];
      } else {
        func = mod;
      }
      result.contentType = 'data';
      result.content = await func(...args);
    } catch (e) {
      result.contentType = 'error';
      result.content = errorUtils.errorToJson(e);
    }

    if (awaitResponse) {
      if (child) {
        child.send(result);
      } else {
        return result;
      }
    }
  }

  addCall(location, method, args) {
    if (this.ending) return; // don't add anything new to the queue

    return new Promise((resolve, reject) => {
      this.callQueue.push({
        location,
        method,
        args: args,
        retries: 0,
        resolve,
        reject
      });
      this.processQueue();
    });
  }

  async end() {
    this.ending = true;
    for (let childId of this.children.keys()) {
      this.stopChild(childId);
    }
    this.ending = false;
    shared = null;
  }

  init(options) {
    this.workerOptions = options;
    require('../worker').init(options, true);
    this.initRemoteWorkers(options);
  }

  initRemoteWorkers(options) {
    this.started = false;

    // Start workers if there isn't enough workers already
    for (
      let i = this.children.size;
      i < this.options.maxConcurrentWorkers;
      i++
    ) {
      this.startChild();
    }

    // Reliable way of initialising workers
    for (let child of this.children.values()) {
      child.setWorkerOptions(options);
    }

    if (this.options.maxConcurrentWorkers > 0) {
      this.started = true;
      this.emit('started');
    }
  }

  shouldUseRemoteWorkers() {
    return (
      !this.options.useLocalWorker ||
      (this.started &&
        (this.warmWorkers >= this.children.size || !this.options.warmWorkers))
    );
  }

  static getShared(options) {
    if (!shared) {
      shared = new WorkerFarm(options);
    } else if (options) {
      shared.init(options);
    }

    return shared;
  }

  static getNumWorkers() {
    if (process.env.PARCEL_WORKERS) {
      return parseInt(process.env.PARCEL_WORKERS, 10);
    }

    let cores;
    try {
      cores = require('physical-cpu-count');
    } catch (err) {
      cores = os.cpus().length;
    }
    return cores || 1;
  }
}

module.exports = WorkerFarm;

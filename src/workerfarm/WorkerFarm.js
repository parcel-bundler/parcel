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
        forcedKillTime: 500,
        warmWorkers: true,
        useLocalWorker: true,
        workerPath: '../worker'
      },
      farmOptions
    );

    this.warmWorkers = 0;
    this.children = new Map();
    this.callQueue = [];

    this.localWorker = require(this.options.workerPath);
    this.run = this.mkhandle('run');

    this.init(options);
  }

  warmupWorker(method, args) {
    // Workers are not warmed up yet.
    // Send the job to a remote worker in the background,
    // but use the result from the local worker - it will be faster.
    let promise = this.addCall(method, [...args, true]);
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

  mkhandle(method) {
    return function(...args) {
      // Child process workers are slow to start (~600ms).
      // While we're waiting, just run on the main thread.
      // This significantly speeds up startup time.
      if (this.shouldUseRemoteWorkers()) {
        return this.addCall(method, [...args, false]);
      } else {
        if (this.options.warmWorkers) {
          this.warmupWorker(method, args);
        }

        return this.localWorker[method](...args, false);
      }
    }.bind(this);
  }

  onError(error, child) {
    // Handle ipc errors
    if (error.code === 'ERR_IPC_CHANNEL_CLOSED') {
      return this.stopChild(child);
    }
  }

  onExit(child) {
    // delay this to give any sends a chance to finish
    setTimeout(() => {
      let doQueue = false;
      if (child && child.calls.size) {
        for (let call of child.calls.values()) {
          call.retries++;
          this.callQueue.unshift(call);
          doQueue = true;
        }
      }
      this.stopChild(child);
      if (doQueue) {
        this.processQueue();
      }
    }, 10);
  }

  startChild() {
    let worker = new Worker(this.options);

    worker.fork(this.options.workerPath, this.bundlerOptions);

    worker.on('request', data => {
      this.processRequest(data, worker);
    });

    worker.once('exit', () => {
      this.onExit(worker);
    });

    worker.on('error', err => {
      this.onError(err, worker);
    });

    worker.on('ready', () => this.processQueue());
    worker.on('response', () => this.processQueue());

    this.children.set(worker.id, worker);
  }

  stopChild(child) {
    child.stop();
    this.children.delete(child.id);
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

      if (!child.ready) {
        continue;
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

  addCall(method, args) {
    if (this.ending) return; // don't add anything new to the queue

    return new Promise((resolve, reject) => {
      this.callQueue.push({
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
    for (let child of this.children.values()) {
      this.stopChild(child);
    }
    this.ending = false;
    shared = null;
  }

  init(bundlerOptions) {
    this.bundlerOptions = bundlerOptions;
    this.persistBundlerOptions();
    this.localWorker.init(bundlerOptions);
  }

  persistBundlerOptions() {
    for (let worker of this.children.values()) {
      worker.init(this.bundlerOptions);
    }
  }

  shouldUseRemoteWorkers() {
    return (
      !this.options.useLocalWorker ||
      (this.warmWorkers >= this.children.size || !this.options.warmWorkers)
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

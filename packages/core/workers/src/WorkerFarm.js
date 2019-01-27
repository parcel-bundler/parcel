const {EventEmitter} = require('events');
const {errorUtils} = require('@parcel/utils');
const Worker = require('./Worker');
const cpuCount = require('./cpuCount');
import Handle from './Handle';

let shared = null;

/**
 * workerPath should always be defined inside farmOptions
 */

export default class WorkerFarm extends EventEmitter {
  constructor(options, farmOptions = {}) {
    super();
    this.options = {
      maxConcurrentWorkers: WorkerFarm.getNumWorkers(),
      maxConcurrentCallsPerWorker: WorkerFarm.getConcurrentCallsPerWorker(),
      forcedKillTime: 500,
      warmWorkers: false,
      useLocalWorker: true
    };

    if (farmOptions) {
      this.options = Object.assign(this.options, farmOptions);
    }

    this.warmWorkers = 0;
    this.workers = new Map();
    this.callQueue = [];
    this.handles = new Map();

    if (!this.options.workerPath) {
      throw new Error('Please provide a worker path!');
    }

    this.localWorker = require(this.options.workerPath);
    this.run = this.mkhandle('run');

    this.init(options);
  }

  warmupWorker(method, args) {
    // Workers are already stopping
    if (this.ending) {
      return;
    }

    // Workers are not warmed up yet.
    // Send the job to a remote worker in the background,
    // but use the result from the local worker - it will be faster.
    let promise = this.addCall(method, [...args, true]);
    if (promise) {
      promise
        .then(() => {
          this.warmWorkers++;
          if (this.warmWorkers >= this.workers.size) {
            this.emit('warmedup');
          }
        })
        .catch(() => {});
    }
  }

  shouldStartRemoteWorkers() {
    return (
      this.options.maxConcurrentWorkers > 0 || !this.options.useLocalWorker
    );
  }

  mkhandle(method) {
    return (...args) => {
      // Child process workers are slow to start (~600ms).
      // While we're waiting, just run on the main thread.
      // This significantly speeds up startup time.
      if (this.shouldUseRemoteWorkers()) {
        return this.addCall(method, [...args, false]);
      } else {
        if (this.options.warmWorkers && this.shouldStartRemoteWorkers()) {
          this.warmupWorker(method, args);
        }

        return this.localWorker[method](...args, false);
      }
    };
  }

  onError(error, worker) {
    // Handle ipc errors
    if (error.code === 'ERR_IPC_CHANNEL_CLOSED') {
      return this.stopWorker(worker);
    }
  }

  startChild() {
    let worker = new Worker(this.options);

    worker.fork(this.options.workerPath, this.bundlerOptions);

    worker.on('request', data => this.processRequest(data, worker));

    worker.on('ready', () => this.processQueue());
    worker.on('response', () => this.processQueue());

    worker.on('error', err => this.onError(err, worker));
    worker.once('exit', () => this.stopWorker(worker));

    this.workers.set(worker.id, worker);
  }

  async stopWorker(worker) {
    if (!worker.stopped) {
      this.workers.delete(worker.id);

      worker.isStopping = true;

      if (worker.calls.size) {
        for (let call of worker.calls.values()) {
          call.retries++;
          this.callQueue.unshift(call);
        }
      }

      worker.calls = null;

      await worker.stop();

      // Process any requests that failed and start a new worker
      this.processQueue();
    }
  }

  async processQueue() {
    if (this.ending || !this.callQueue.length) return;

    if (this.workers.size < this.options.maxConcurrentWorkers) {
      this.startChild();
    }

    for (let worker of this.workers.values()) {
      if (!this.callQueue.length) {
        break;
      }

      if (!worker.ready || worker.stopped || worker.isStopping) {
        continue;
      }

      if (worker.calls.size < this.options.maxConcurrentCallsPerWorker) {
        worker.call(this.callQueue.shift());
      }
    }
  }

  async processRequest(data, worker = false) {
    let result = {
      idx: data.idx,
      type: 'response'
    };

    let method = data.method;
    let args = data.args;
    let awaitResponse = data.awaitResponse;

    let mod;
    if (data.handle) {
      mod = this.handles.get(data.handle);
      if (!mod) {
        throw new Error('Unknown handle');
      }
    } else if (data.location) {
      mod = require(data.location);
    } else {
      throw new Error('Unknown request');
    }

    try {
      result.contentType = 'data';
      if (method) {
        result.content = await mod[method](...args);
      } else {
        result.content = await mod(...args);
      }
    } catch (e) {
      result.contentType = 'error';
      result.content = errorUtils.errorToJson(e);
    }

    if (awaitResponse) {
      if (worker) {
        worker.send(result);
      } else {
        return result;
      }
    }
  }

  addCall(method, args) {
    if (this.ending) {
      throw new Error('Cannot add a worker call if workerfarm is ending.');
    }

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

  createHandle(fn) {
    let handle = new Handle();
    this.handles.set(handle.id, fn);
    return handle;
  }

  async end() {
    this.ending = true;
    await Promise.all(
      Array.from(this.workers.values()).map(worker => this.stopWorker(worker))
    );
    this.ending = false;
    shared = null;
  }

  init(bundlerOptions) {
    this.bundlerOptions = bundlerOptions;

    if (this.shouldStartRemoteWorkers()) {
      this.persistBundlerOptions();
    }

    this.localWorker.init(bundlerOptions);
    this.startMaxWorkers();
  }

  persistBundlerOptions() {
    for (let worker of this.workers.values()) {
      worker.init(this.bundlerOptions);
    }
  }

  startMaxWorkers() {
    // Starts workers until the maximum is reached
    if (this.workers.size < this.options.maxConcurrentWorkers) {
      for (
        let i = 0;
        i < this.options.maxConcurrentWorkers - this.workers.size;
        i++
      ) {
        this.startChild();
      }
    }
  }

  shouldUseRemoteWorkers() {
    return (
      !this.options.useLocalWorker ||
      ((this.warmWorkers >= this.workers.size || !this.options.warmWorkers) &&
        this.options.maxConcurrentWorkers > 0)
    );
  }

  static async getShared(options, farmOptions) {
    // Farm options shouldn't be considered safe to overwrite
    // and require an entire new instance to be created
    if (
      shared &&
      farmOptions &&
      farmOptions.workerPath !== shared.options.workerPath
    ) {
      await shared.end();
      shared = null;
    }

    if (!shared) {
      shared = new WorkerFarm(options, farmOptions);
    } else if (options) {
      Object.assign(shared.options, farmOptions);
      shared.init(options);
    }

    if (!shared && !options) {
      throw new Error('Workerfarm should be initialised using options');
    }

    return shared;
  }

  static getNumWorkers() {
    return process.env.PARCEL_WORKERS
      ? parseInt(process.env.PARCEL_WORKERS, 10)
      : cpuCount();
  }

  static async callMaster(request, awaitResponse = true) {
    if (WorkerFarm.isWorker()) {
      const child = require('./child');
      return child.addCall(request, awaitResponse);
    } else {
      return (await WorkerFarm.getShared()).processRequest(request);
    }
  }

  static createHandle(fn) {
    if (WorkerFarm.isWorker()) {
    } else {
      return shared.createHandle(fn);
    }
  }

  static isWorker() {
    return process.send && require.main.filename === require.resolve('./child');
  }

  static getConcurrentCallsPerWorker() {
    return parseInt(process.env.PARCEL_MAX_CONCURRENT_CALLS, 10) || 5;
  }
}

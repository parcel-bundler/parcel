const {EventEmitter} = require('events');
const os = require('os');
const fork = require('./fork');
const errorUtils = require('./errorUtils');

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
        useLocalWorker: true,
        workerPath: require.resolve('../worker')
      },
      farmOptions
    );

    this.started = false;
    this.childId = 0;
    this.warmWorkers = 0;
    this.children = new Map();
    this.callQueue = [];

    this.localWorker = require(this.options.workerPath);
    this.remoteWorker = {
      run: this.mkhandle('run')
    };

    this.init(options);
  }

  mkhandle(method) {
    return function(...args) {
      return new Promise((resolve, reject) => {
        this.addCall({
          method,
          args: args,
          retries: 0,
          type: 'request',
          resolve,
          reject
        });
      });
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
    let id = this.childId++;
    let forked = fork(this.options.workerPath, id);
    let c = {
      send: forked.send,
      child: forked.child,
      calls: new Map(),
      exitCode: null,
      callId: 0,
      id
    };

    forked.child.on('message', this.receive.bind(this));
    forked.child.once('exit', code => {
      c.exitCode = code;
      this.onExit(id);
    });
    forked.child.on('error', err => {
      this.onError(err, id);
    });

    this.children.set(id, c);
  }

  stopChild(childId) {
    let child = this.children.get(childId);
    if (child) {
      child.send('die');
      setTimeout(() => {
        if (child.exitCode === null) {
          child.child.kill('SIGKILL');
        }
      }, this.options.forcedKillTime);
      this.children.delete(childId);
    }
  }

  receive(data) {
    let idx = data.idx;
    let childId = data.child;
    let child = this.children.get(childId);
    let type = data.type;
    let content = data.content;
    let contentType = data.contentType;

    // Possibly premature child death
    if (!child) {
      return;
    }

    if (type === 'request') {
      this.processRequest(data, child);
    } else if (type === 'response') {
      let call = child.calls.get(idx);
      if (!call) {
        throw new Error(
          `Worker Farm: Received message for unknown index for existing child. This should not happen!`
        );
      }

      if (contentType === 'error') {
        call.reject(errorUtils.jsonToError(content));
      } else {
        call.resolve(content);
      }

      child.calls.delete(idx);

      // allow any outstanding calls to be processed
      this.processQueue();
    }
  }

  send(childId, call) {
    let child = this.children.get(childId);
    let idx = child.callId++;

    child.calls.set(idx, call);

    child.send({
      idx: idx,
      child: childId,
      method: call.method,
      args: call.args,
      type: call.type
    });
  }

  async processQueue() {
    if (this.ending || !this.callQueue.length) return;

    if (this.children.size < this.options.maxConcurrentWorkers) {
      this.startChild();
    }

    for (let [childId, child] of this.children.entries()) {
      if (!this.callQueue.length) {
        break;
      }

      if (child.calls.size < this.options.maxConcurrentCallsPerWorker) {
        this.send(childId, this.callQueue.shift());
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

  addCall(call) {
    if (this.ending) return; // don't add anything new to the queue
    this.callQueue.push(call);
    this.processQueue();
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
    this.localWorker.init(options, true);
    this.initRemoteWorkers(options);
  }

  async initRemoteWorkers(options) {
    this.started = false;
    this.warmWorkers = 0;

    // Start workers if there isn't enough workers already
    for (
      let i = this.children.size;
      i < this.options.maxConcurrentWorkers;
      i++
    ) {
      this.startChild();
    }

    // Reliable way of initialising workers
    let promises = [];
    for (let childId of this.children.keys()) {
      promises.push(
        new Promise((resolve, reject) => {
          this.send(childId, {
            method: 'init',
            args: [options],
            retries: 0,
            type: 'request',
            resolve,
            reject
          });
        })
      );
    }

    await Promise.all(promises);
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

  async warmupWorker(...args) {
    // Workers have started, but are not warmed up yet.
    // Send the job to a remote worker in the background,
    // but use the result from the local worker - it will be faster.
    if (this.started) {
      this.remoteWorker
        .run(...args, true)
        .then(() => {
          this.warmWorkers++;
          if (this.warmWorkers >= this.children.size) {
            this.emit('warmedup');
          }
        })
        .catch(() => {});
    }
  }

  async run(...args) {
    // Child process workers are slow to start (~600ms).
    // While we're waiting, just run on the main thread.
    // This significantly speeds up startup time.
    if (this.shouldUseRemoteWorkers()) {
      return this.remoteWorker.run(...args, false);
    } else {
      if (this.options.warmWorkers) {
        this.warmupWorker(...args);
      }

      return this.localWorker.run(...args, false);
    }
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

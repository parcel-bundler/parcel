const os = require('os');
const logger = require('../Logger');
const fork = require('./fork');

let shared = null;

class WorkerFarm {
  constructor(options) {
    this.options = {
      maxConcurrentWorkers: WorkerFarm.getNumWorkers(),
      maxConcurrentCallsPerWorker: 10,
      forcedKillTime: 100
    };

    this.path =
      parseInt(process.versions.node, 10) < 8
        ? require.resolve('../../lib/workerfarm/worker')
        : require.resolve('../../src/workerfarm/worker');

    this.localWorker = require('./worker');
    this.remoteWorker = {
      run: this.mkhandle('run'),
      init: this.mkhandle('init')
    };

    this.started = false;
    this.childId = -1;
    this.activeChildren = 0;
    this.warmWorkers = 0;
    this.children = new Map();
    this.callQueue = [];

    this.init(options);
  }

  mkhandle(method) {
    return function(...args) {
      return new Promise((resolve, reject) => {
        this.addCall({
          method,
          args: args,
          retries: 0,
          resolve,
          reject
        });
      });
    }.bind(this);
  }

  onExit(childId) {
    // delay this to give any sends a chance to finish
    setTimeout(
      function() {
        let doQueue = false;
        let child = this.children.get(childId);
        if (child && child.activeCalls) {
          child.calls.forEach(call => {
            if (!call) {
              return;
            }
            call.retries++;
            this.callQueue.unshift(call);
            doQueue = true;
          });
        }
        this.stopChild(childId);
        if (doQueue) {
          this.processQueue();
        }
      }.bind(this),
      10
    );
  }

  async startChild() {
    this.childId++;

    let id = this.childId;
    let forked = fork(this.path, id);
    let c = {
      send: forked.send,
      child: forked.child,
      calls: [],
      activeCalls: 0,
      exitCode: null
    };

    forked.child.on('message', this.receive.bind(this));
    forked.child.once(
      'exit',
      function(code) {
        c.exitCode = code;
        this.onExit(id);
      }.bind(this)
    );

    this.activeChildren++;
    this.children.set(id, c);
  }

  stopChild(childId) {
    let child = this.children.get(childId);
    if (child) {
      child.send('die');
      setTimeout(function() {
        if (child.exitCode === null) {
          child.child.kill('SIGKILL');
        }
      }, this.options.forcedKillTime);
      this.children.delete(childId);
      this.activeChildren--;
    }
  }

  receive(data) {
    let idx = data.idx;
    let childId = data.child;
    let child = this.children.get(childId);
    let type = data.type;
    let content = data.content;

    // Possibly premature child death
    if (!child) {
      return;
    }

    if (type === 'logger') {
      if (this.shouldUseRemoteWorkers()) {
        logger.handleMessage(data);
      }
    } else if (type === 'request') {
      this.processRequest(data, child);
    } else if (type === 'result' || 'error') {
      let call = child.calls[idx];
      if (!call) {
        throw new Error(
          `Worker Farm: Received message for unknown index for existing child. This should not happen!`
        );
      }

      if (type === 'error') {
        let error = new Error(content.message);
        Object.keys(content).forEach(key => {
          error[key] = content[key];
        });
        process.nextTick(function() {
          call.reject(error);
        });
      } else {
        process.nextTick(function() {
          call.resolve(content);
        });
      }

      delete child.calls[idx];
      child.activeCalls--;
      this.activeCalls--;

      // allow any outstanding calls to be processed
      this.processQueue();
    }
  }

  send(childId, call) {
    let child = this.children.get(childId);
    let idx = child.calls.length;

    child.calls.push(call);
    child.activeCalls++;
    this.activeCalls++;

    child.send({
      idx: idx,
      child: childId,
      method: call.method,
      args: call.args
    });
  }

  async processQueue() {
    if (this.activeChildren < this.options.maxConcurrentWorkers) {
      await this.startChild();
    }

    if (this.callQueue.length > 0) {
      for (let [childId, child] of this.children.entries()) {
        if (child.activeCalls < this.options.maxConcurrentCallsPerWorker) {
          this.send(childId, this.callQueue.shift());
          if (!this.callQueue.length) {
            return this.ending && this.end();
          }
        }
      }
    }

    if (this.ending) {
      this.end();
    }
  }

  async processRequest(request, child = false) {
    let response = {
      idx: request.idx
    };
    if (request.location) {
      const mod = require(request.location);
      try {
        let func;
        if (request.method) {
          func = mod[request.method];
        } else {
          func = mod;
        }
        let result = await func(...request.args);
        response.result = result;
      } catch (e) {
        response.error = {
          type: e.constructor.name,
          message: e.message,
          stack: e.stack
        };
      }
    }
    if (child) {
      child.send({
        type: 'response',
        method: 'respond',
        args: [response]
      });
      child.send(response);
    } else {
      return response;
    }
  }

  addCall(call) {
    if (this.ending) {
      return this.end(); // don't add anything new to the queue
    }
    this.callQueue.push(call);
    this.processQueue();
  }

  async end() {
    // Force kill all children
    this.ending = true;
    this.children.forEach(child => {
      this.stopChild(child);
    });
    this.ending = false;
    shared = null;
  }

  init(options) {
    this.localWorker.init(options);
    this.initRemoteWorkers(options);
  }

  async initRemoteWorkers(options) {
    this.started = false;
    this.warmWorkers = 0;

    let promises = [];
    for (let i = 0; i < this.options.maxConcurrentWorkers; i++) {
      promises.push(this.remoteWorker.init(options));
    }

    await Promise.all(promises);
    if (this.options.maxConcurrentWorkers > 0) {
      this.started = true;
    }
  }

  shouldUseRemoteWorkers() {
    return this.started && this.warmWorkers >= this.activeChildren;
  }

  async run(...args) {
    // Child process workers are slow to start (~600ms).
    // While we're waiting, just run on the main thread.
    // This significantly speeds up startup time.
    if (this.shouldUseRemoteWorkers()) {
      return this.remoteWorker.run(...args, false);
    } else {
      // Workers have started, but are not warmed up yet.
      // Send the job to a remote worker in the background,
      // but use the result from the local worker - it will be faster.
      if (this.started) {
        this.remoteWorker
          .run(...args, true)
          .then(() => {
            this.warmWorkers++;
          })
          .catch(() => null);
      }

      return this.localWorker.run(...args, false);
    }
  }

  static getShared(options) {
    if (!shared) {
      shared = new WorkerFarm(options || {});
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

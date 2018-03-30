const {EventEmitter} = require('events');
const os = require('os');
const logger = require('./Logger');
const fork = require('./workerfarm/fork');

let shared = null;

class WorkerFarm extends EventEmitter {
  constructor(options) {
    super();

    this.options = {
      maxConcurrentWorkers: WorkerFarm.getNumWorkers(),
      maxCallsPerWorker: Infinity,
      maxConcurrentCallsPerWorker: 10,
      maxConcurrentCalls: Infinity,
      maxRetries: Infinity,
      forcedKillTime: 100
    };

    this.path =
      parseInt(process.versions.node, 10) < 8
        ? require.resolve('../lib/worker')
        : require.resolve('../src/worker');

    this.localWorker = require('./worker');
    this.remoteWorker = {
      init: this.mkhandle('init'),
      run: this.mkhandle('run')
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
    return async function(...args) {
      if (this.activeCalls >= this.options.maxConcurrentCalls) {
        throw new Error(`Too many concurrent calls (${this.activeCalls})`);
      }
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
          child.calls.forEach(
            function(call, i) {
              if (!call) {
                return;
              } else if (call.retries >= this.options.maxRetries) {
                this.receive({
                  idx: i,
                  child: childId,
                  args: [
                    new Error('cancel after ' + call.retries + ' retries!')
                  ]
                });
              } else {
                call.retries++;
                this.callQueue.unshift(call);
                doQueue = true;
              }
            }.bind(this)
          );
        }
        this.stopChild(childId);
        if (doQueue) {
          this.processQueue();
        }
      }.bind(this),
      10
    );
  }

  startChild() {
    this.childId++;

    let forked = fork(this.path);
    let id = this.childId;
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
    } else if (type === 'event') {
      this.emit(data.event, ...data.args);
    } else if (type === 'result' || 'error') {
      let call = child.calls[idx];
      if (!call) {
        return console.error(`Worker Farm: Received message for unknown index 
            for existing child. This should not happen!`);
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

      if (
        child.calls.length >= this.options.maxCallsPerWorker &&
        !Object.keys(child.calls).length
      ) {
        // this child has finished its run, kill it
        this.stopChild(childId);
      }

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

  processQueue() {
    if (!this.callQueue.length) {
      return this.ending && this.end();
    }

    if (this.activeChildren < this.options.maxConcurrentWorkers) {
      this.startChild();
    }

    for (let [childId, child] of this.children.entries()) {
      if (
        child.activeCalls < this.options.maxConcurrentCallsPerWorker &&
        child.calls.length < this.options.maxCallsPerWorker
      ) {
        this.send(childId, this.callQueue.shift());
        if (!this.callQueue.length) {
          return this.ending && this.end();
        }
      }
    }

    if (this.ending) {
      this.end();
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
      shared = new WorkerFarm(options);
    } else {
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

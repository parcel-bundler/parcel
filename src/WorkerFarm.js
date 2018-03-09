const {EventEmitter} = require('events');
const os = require('os');
const Farm = require('worker-farm/lib/farm');
const promisify = require('./utils/promisify');
const logger = require('./Logger');
const Asset = require('./Asset');

let shared = null;

class WorkerFarm extends Farm {
  constructor(options, bundler) {
    let opts = {
      maxConcurrentWorkers: getNumWorkers()
    };

    let workerPath =
      parseInt(process.versions.node, 10) < 8
        ? require.resolve('../lib/worker')
        : require.resolve('../src/worker');

    super(opts, workerPath);

    this.localWorker = this.promisifyWorker(require('./worker'));
    this.remoteWorker = this.promisifyWorker(this.setup(['init', 'run']));

    this.started = false;
    this.warmWorkers = 0;
    this.bundlers = new Map();
    this.init(options, bundler);
  }

  init(options, bundler) {
    this.localWorker.init(options);
    this.initRemoteWorkers(options);
    if (bundler) {
      this.bundlers.set(options.mainFile, bundler);
    }
  }

  async bundlerCall(options) {
    if (!options.mainFile || !options.method) {
      return;
    }
    const bundler = this.bundlers.get(options.mainFile);
    if (bundler) {
      let res = await bundler[options.method](...options.args);
      if (res instanceof Asset) {
        return {
          name: res.name,
          package: res.package
        };
      }
      return res;
    }
    return;
  }

  promisifyWorker(worker) {
    let res = {};

    for (let key in worker) {
      res[key] = promisify(worker[key].bind(worker));
    }

    return res;
  }

  async initRemoteWorkers(options) {
    this.started = false;
    this.warmWorkers = 0;

    let promises = [];
    for (let i = 0; i < this.options.maxConcurrentWorkers; i++) {
      options.childId = i;
      promises.push(this.remoteWorker.init(options));
    }

    await Promise.all(promises);
    if (this.options.maxConcurrentWorkers > 0) {
      this.started = true;
    }
  }

  async handleRequest(data) {
    let result;
    switch (data.type) {
      case 'logger':
        if (this.shouldUseRemoteWorkers()) {
          logger.handleMessage(data);
        }
        break;
      case 'bundlerCall':
        result = await this.bundlerCall(data);
        break;
    }
    return result
      ? {
          id: data.id,
          type: data.type,
          result
        }
      : null;
  }

  receive(data) {
    if (data.event) {
      this.emit(data.event, ...data.args);
    } else if (this.children[data.child]) {
      if (data.type) {
        this.handleRequest(data)
          .then(result => {
            if (result) {
              this.children[data.child].send(result);
            }
          })
          .catch(() => {});
      } else {
        super.receive(data);
      }
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
        this.remoteWorker.run(...args, true).then(
          () => {
            this.warmWorkers++;
          },
          () => {
            // ignore error
          }
        );
      }

      return this.localWorker.run(...args, false);
    }
  }

  end() {
    // Force kill all children
    this.ending = true;
    for (let child in this.children) {
      this.stopChild(child);
    }

    this.ending = false;
    shared = null;
  }

  static getShared(options, bundler) {
    if (!shared) {
      shared = new WorkerFarm(options, bundler);
    } else if (options) {
      shared.init(options);
    }

    return shared;
  }
}

for (let key in EventEmitter.prototype) {
  WorkerFarm.prototype[key] = EventEmitter.prototype[key];
}

function getNumWorkers() {
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

module.exports = WorkerFarm;

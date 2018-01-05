const os = require('os');
const WorkerNodes = require('worker-nodes');
const path = require('path');

class WorkerFarm {
  constructor(options) {
    this.options = options;
    this.started = false;

    // Start workers
    this.localWorker = require('./worker');
    let workerOptions = {
      autoStart: true,
      lazyStart: true,
      maxWorkers: getNumWorkers(),
      minWorkers: 1
    };
    this.workerNodes = new WorkerNodes(
      path.resolve(path.join(__dirname, 'worker.js')),
      workerOptions
    );

    this.init();
  }

  async init() {
    await this.workerNodes.ready();
    this.started = true;
  }

  async run(...args) {
    // Child process workers are slow to start (~600ms).
    // While we're waiting, just run on the main thread.
    // This significantly speeds up startup time.
    if (!this.started) {
      return this.localWorker.run(...args, this.options);
    } else {
      return this.workerNodes.call.run(...args, this.options);
    }
  }

  async end() {
    await this.workerNodes.terminate();
  }
}

function getNumWorkers() {
  let cores;
  try {
    cores = require('physical-cpu-count');
  } catch (err) {
    cores = os.cpus().length;
  }
  return cores || 1;
}

module.exports = WorkerFarm;

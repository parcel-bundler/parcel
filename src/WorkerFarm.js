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
    this.workerNodes
      .ready()
      .then(() => {
        this.started = true;
      })
      .catch(error => {
        throw error;
      });

    this.run.bind(this);
  }

  async run(...args) {
    // Child process workers are slow to start (~600ms).
    // While we're waiting, just run on the main thread.
    // This significantly speeds up startup time.
    if (!this.started) {
      return this.localWorker(...args, this.options);
    } else {
      return this.workerNodes.call(...args, this.options);
    }
  }

  async end() {
    await this.workerNodes.terminate();
    this.workerNodes = null;
  }
}

function getNumWorkers() {
  let cores;
  try {
    cores = require('physical-cpu-count');
  } catch (err) {
    cores = os.cpus().length;
  }
  return cores > 1 ? cores - 1 : 1 || 1;
}

module.exports = WorkerFarm;

const Worker = require('jest-worker').default;

class WorkerFarm {
  constructor() {
    // Start workers
    this.localWorker = require('./worker');
    this.remoteWorkers = new Worker(require.resolve('./worker'), {
      exposedMethods: ['init', 'run', 'isReady']
    });

    this.initRemoteWorkers();
  }

  async initRemoteWorkers() {
    this.started = false;

    // Wait for first worker to be ready
    await this.remoteWorkers.isReady();

    this.started = true;
  }

  async run(...args) {
    // Child process workers are slow to start (~600ms).
    // While we're waiting, just run on the main thread.
    // This significantly speeds up startup time.
    if (!this.started) {
      return this.localWorker.run(...args);
    } else {
      return this.remoteWorkers.run(...args);
    }
  }

  end() {
    this.remoteWorkers.end();
  }
}

module.exports = WorkerFarm;

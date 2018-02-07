class PromiseQueue {
  constructor(callback) {
    this.process = callback;
    this.queue = [];
    this.processing = new Set();
    this.processed = new Set();
    this.runPromise = null;
    this.resolve = null;
    this.reject = null;
  }

  add(job, ...args) {
    if (this.processing.has(job)) {
      return;
    }

    if (this.runPromise) {
      this._runJob(job, args);
    } else {
      this.queue.push([job, args]);
    }

    this.processing.add(job);
  }

  run() {
    if (this.runPromise) {
      return this.runPromise;
    }

    const runPromise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });

    this.runPromise = runPromise;
    this._next();

    return runPromise;
  }

  async _runJob(job, args) {
    try {
      await this.process(job, ...args);
      this.processing.delete(job);
      this.processed.add(job);
      this._next();
    } catch (err) {
      this.queue.push([job, args]);
      this.reject(err);
      this._reset();
    }
  }

  _next() {
    if (!this.runPromise) {
      return;
    }

    if (this.queue.length > 0) {
      while (this.queue.length > 0) {
        this._runJob(...this.queue.shift());
      }
    } else if (this.processing.size === 0) {
      this.resolve(this.processed);
      this._reset();
    }
  }

  _reset() {
    this.processed = new Set();
    this.runPromise = null;
    this.resolve = null;
    this.reject = null;
  }
}

module.exports = PromiseQueue;

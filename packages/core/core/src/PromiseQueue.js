// @flow

type PromiseQueueOpts = {|
  maxConcurrent: number
|};

export default class PromiseQueue {
  _queue: Array<Function>;
  _running: boolean;
  _numRunning: number;
  _maxConcurrent: number;
  _resolve: Function;
  _reject: Function;

  constructor(opts: PromiseQueueOpts = {maxConcurrent: Infinity}) {
    this._resetState();
    this._maxConcurrent = opts.maxConcurrent;
  }

  _resetState() {
    this._queue = [];
    this._running = false;
    this._numRunning = 0;
  }

  add(fn: Function) {
    this._queue.push(fn);
  }

  run(): Promise<void> {
    if (this._queue.length === 0) {
      return Promise.resolve();
    }

    // ? What should we do if queue is already running?
    // Should we throw an error since we are using the same queue for different phases and trying to
    //  run while it's already running is probably in error
    // Or just be fault tolerant and return the already running promise?
    this._running = true;

    return new Promise((resolve, reject) => {
      this._reject = e => {
        this._resetState();
        reject(e);
      };

      this._resolve = () => {
        this._resetState();
        resolve();
      };

      while (this._queue.length && this._numRunning < this._maxConcurrent) {
        this._next();
      }
    });
  }

  async _next() {
    let fn = this._queue.shift();
    await this._runFn(fn);
    if (this._queue.length) {
      this._next();
    } else if (this._numRunning === 0) {
      this._resolve();
    }
  }

  async _runFn(fn: Function) {
    try {
      this._numRunning++;
      await fn();
      this._numRunning--;
    } catch (e) {
      this._reject(e);
    }
  }
}

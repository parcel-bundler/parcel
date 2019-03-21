// @flow strict-local

import invariant from 'assert';

type PromiseQueueOpts = {
  maxConcurrent?: number,
  retry?: boolean
};

export default class PromiseQueue<TFirstArg, TRestArgs: Array<mixed>, TRet> {
  process: (first: TFirstArg, ...rest: TRestArgs) => Promise<TRet>;
  retry: boolean;
  queue: Array<[TFirstArg, TRestArgs]> = [];
  processing: Set<TFirstArg> = new Set();
  processed: Set<TFirstArg> = new Set();
  maxConcurrent: number;
  numRunning: number = 0;
  runPromise: ?Promise<Set<TFirstArg>> = null;
  resolve: ?(Set<TFirstArg>) => void = null;
  reject: ?(Error) => void = null;

  constructor(
    callback: (TFirstArg, ...TRestArgs) => Promise<TRet>,
    options: PromiseQueueOpts = {}
  ) {
    if (options.maxConcurrent != null && options.maxConcurrent <= 0) {
      throw new TypeError('maxConcurrent must be a positive, non-zero value');
    }

    this.process = callback;
    this.maxConcurrent =
      options.maxConcurrent == null ? Infinity : options.maxConcurrent;
    this.retry = options.retry !== false;
  }

  add(job: TFirstArg, ...args: TRestArgs): void {
    if (this.processing.has(job)) {
      return;
    }

    if (this.runPromise && this.numRunning < this.maxConcurrent) {
      this._runJob(job, args);
    } else {
      this.queue.push([job, args]);
    }

    this.processing.add(job);
  }

  run(): Promise<Set<TFirstArg>> {
    if (this.runPromise) {
      return this.runPromise;
    }

    const runPromise = new Promise<Set<TFirstArg>>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });

    this.runPromise = runPromise;
    this._next();

    return runPromise;
  }

  async _runJob(job: TFirstArg, args: TRestArgs) {
    try {
      this.numRunning++;
      await this.process(job, ...args);
      this.processing.delete(job);
      this.processed.add(job);
      this.numRunning--;
      this._next();
    } catch (err) {
      this.numRunning--;
      if (this.retry) {
        this.queue.push([job, args]);
      } else {
        this.processing.delete(job);
      }

      if (this.reject) {
        this.reject(err);
      }

      this._reset();
    }
  }

  _next() {
    if (!this.runPromise) {
      return;
    }

    if (this.queue.length > 0) {
      while (this.queue.length > 0 && this.numRunning < this.maxConcurrent) {
        this._runJob(...this.queue.shift());
      }
    } else if (this.processing.size === 0) {
      invariant(this.resolve != null);
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

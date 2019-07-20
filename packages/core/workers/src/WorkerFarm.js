// @flow

import type {ErrorWithCode, FilePath} from '@parcel/types';
import type {
  CallRequest,
  WorkerRequest,
  WorkerDataResponse,
  WorkerErrorResponse,
  BackendType
} from './types';

import nullthrows from 'nullthrows';
import EventEmitter from 'events';
import {deserialize, errorToJson, jsonToError, serialize} from '@parcel/utils';
import Worker, {type WorkerCall} from './Worker';
import cpuCount from './cpuCount';
import Handle from './Handle';
import {child} from './childState';
import {detectBackend} from './backend';

let shared = null;

type FarmOptions = {|
  maxConcurrentWorkers: number,
  maxConcurrentCallsPerWorker: number,
  forcedKillTime: number,
  useLocalWorker: boolean,
  warmWorkers: boolean,
  workerPath?: FilePath,
  backend: BackendType
|};

type HandleFunction = (...args: Array<any>) => Promise<any>;

type WorkerModule = {|
  +[string]: (...args: Array<mixed>) => Promise<mixed>
|};

/**
 * workerPath should always be defined inside farmOptions
 */

export default class WorkerFarm extends EventEmitter {
  callQueue: Array<WorkerCall> = [];
  ending: boolean = false;
  localWorker: WorkerModule;
  options: FarmOptions;
  run: HandleFunction;
  warmWorkers: number = 0;
  workers: Map<number, Worker> = new Map();
  handles: Map<number, Handle> = new Map();

  constructor(farmOptions: $Shape<FarmOptions> = {}) {
    super();
    this.options = {
      maxConcurrentWorkers: WorkerFarm.getNumWorkers(),
      maxConcurrentCallsPerWorker: WorkerFarm.getConcurrentCallsPerWorker(),
      forcedKillTime: 500,
      warmWorkers: true,
      useLocalWorker: true,
      backend: detectBackend(),
      ...farmOptions
    };

    if (!this.options.workerPath) {
      throw new Error('Please provide a worker path!');
    }

    // $FlowFixMe this must be dynamic
    this.localWorker = require(this.options.workerPath);
    this.run = this.createHandle('run');

    this.startMaxWorkers();
  }

  warmupWorker(method: string, args: Array<any>): void {
    // Workers are already stopping
    if (this.ending) {
      return;
    }

    // Workers are not warmed up yet.
    // Send the job to a remote worker in the background,
    // but use the result from the local worker - it will be faster.
    let promise = this.addCall(method, [...args, true]);
    if (promise) {
      promise
        .then(() => {
          this.warmWorkers++;
          if (this.warmWorkers >= this.workers.size) {
            this.emit('warmedup');
          }
        })
        .catch(() => {});
    }
  }

  shouldStartRemoteWorkers(): boolean {
    return (
      this.options.maxConcurrentWorkers > 0 || !this.options.useLocalWorker
    );
  }

  createHandle(method: string): HandleFunction {
    return (...args) => {
      // Child process workers are slow to start (~600ms).
      // While we're waiting, just run on the main thread.
      // This significantly speeds up startup time.
      if (this.shouldUseRemoteWorkers()) {
        return this.addCall(method, [...args, false]);
      } else {
        if (this.options.warmWorkers && this.shouldStartRemoteWorkers()) {
          this.warmupWorker(method, args);
        }

        let processedArgs = deserialize(serialize([...args, false]));
        return this.localWorker[method](...processedArgs);
      }
    };
  }

  onError(error: ErrorWithCode, worker: Worker) {
    // Handle ipc errors
    if (error.code === 'ERR_IPC_CHANNEL_CLOSED') {
      return this.stopWorker(worker);
    }
  }

  startChild() {
    let worker = new Worker({
      forcedKillTime: this.options.forcedKillTime,
      backend: this.options.backend
    });

    worker.fork(nullthrows(this.options.workerPath));

    worker.on('request', data => this.processRequest(data, worker));

    worker.on('ready', () => this.processQueue());
    worker.on('response', () => this.processQueue());

    worker.on('error', err => this.onError(err, worker));
    worker.once('exit', () => this.stopWorker(worker));

    this.workers.set(worker.id, worker);
  }

  async stopWorker(worker: Worker): Promise<void> {
    if (!worker.stopped) {
      this.workers.delete(worker.id);

      worker.isStopping = true;

      if (worker.calls.size) {
        for (let call of worker.calls.values()) {
          call.retries++;
          this.callQueue.unshift(call);
        }
      }

      worker.calls.clear();

      await worker.stop();

      // Process any requests that failed and start a new worker
      this.processQueue();
    }
  }

  async processQueue(): Promise<void> {
    if (this.ending || !this.callQueue.length) return;

    if (this.workers.size < this.options.maxConcurrentWorkers) {
      this.startChild();
    }

    for (let worker of this.workers.values()) {
      if (!this.callQueue.length) {
        break;
      }

      if (!worker.ready || worker.stopped || worker.isStopping) {
        continue;
      }

      if (worker.calls.size < this.options.maxConcurrentCallsPerWorker) {
        worker.call(this.callQueue.shift());
      }
    }
  }

  async processRequest(
    data: {|
      location: FilePath
    |} & $Shape<WorkerRequest>,
    worker?: Worker
  ): Promise<?string> {
    let {method, args, location, awaitResponse, idx, handle} = data;
    let mod;
    if (handle) {
      mod = nullthrows(this.handles.get(handle));
    } else if (location) {
      // $FlowFixMe this must be dynamic
      mod = require(location);
    } else {
      throw new Error('Unknown request');
    }

    const responseFromContent = (content: any): WorkerDataResponse => ({
      idx,
      type: 'response',
      contentType: 'data',
      content
    });

    const errorResponseFromError = (e: Error): WorkerErrorResponse => ({
      idx,
      type: 'response',
      contentType: 'error',
      content: errorToJson(e)
    });

    let result;
    if (method == null) {
      try {
        result = responseFromContent(await mod(...args));
      } catch (e) {
        result = errorResponseFromError(e);
      }
    } else {
      // ESModule default interop
      if (mod.__esModule && !mod[method] && mod.default) {
        mod = mod.default;
      }

      try {
        result = responseFromContent(await mod[method](...args));
      } catch (e) {
        result = errorResponseFromError(e);
      }
    }

    if (awaitResponse) {
      if (worker) {
        worker.send(result);
      } else {
        if (result.contentType === 'error') {
          throw jsonToError(result.content);
        }
        return result.content;
      }
    }
  }

  addCall(method: string, args: Array<any>): Promise<any> {
    if (this.ending) {
      throw new Error('Cannot add a worker call if workerfarm is ending.');
    }

    return new Promise((resolve, reject) => {
      this.callQueue.push({
        method,
        args: args,
        retries: 0,
        resolve,
        reject
      });
      this.processQueue();
    });
  }

  async end(): Promise<void> {
    this.ending = true;
    await Promise.all(
      Array.from(this.workers.values()).map(worker => this.stopWorker(worker))
    );
    this.ending = false;
    shared = null;
  }

  startMaxWorkers(): void {
    // Starts workers until the maximum is reached
    if (this.workers.size < this.options.maxConcurrentWorkers) {
      for (
        let i = 0;
        i < this.options.maxConcurrentWorkers - this.workers.size;
        i++
      ) {
        this.startChild();
      }
    }
  }

  shouldUseRemoteWorkers(): boolean {
    return (
      !this.options.useLocalWorker ||
      ((this.warmWorkers >= this.workers.size || !this.options.warmWorkers) &&
        this.options.maxConcurrentWorkers > 0)
    );
  }

  createReverseHandle(fn: () => mixed) {
    let handle = new Handle();
    this.handles.set(handle.id, fn);
    return handle;
  }

  static async getShared(
    farmOptions?: $Shape<FarmOptions>
  ): Promise<WorkerFarm> {
    // Farm options shouldn't be considered safe to overwrite
    // and require an entire new instance to be created
    if (
      shared &&
      farmOptions &&
      farmOptions.workerPath !== shared.options.workerPath
    ) {
      await shared.end();
      shared = null;
    }

    if (!shared) {
      shared = new WorkerFarm(farmOptions);
    }

    return shared;
  }

  static getNumWorkers() {
    return process.env.PARCEL_WORKERS
      ? parseInt(process.env.PARCEL_WORKERS, 10)
      : cpuCount();
  }

  static async callMaster(
    request: CallRequest,
    awaitResponse: boolean = true
  ): Promise<mixed> {
    if (child) {
      return child.addCall(request, awaitResponse);
    } else {
      // $FlowFixMe
      return (await WorkerFarm.getShared()).processRequest({
        ...request,
        awaitResponse
      });
    }
  }

  static isWorker() {
    return !!child;
  }

  static getConcurrentCallsPerWorker() {
    return parseInt(process.env.PARCEL_MAX_CONCURRENT_CALLS, 10) || 5;
  }

  static createReverseHandle(fn: (...args: any[]) => mixed) {
    if (WorkerFarm.isWorker()) {
      throw new Error(
        'Cannot call WorkerFarm.createReverseHandle() from within Worker'
      );
    }

    return nullthrows(shared).createReverseHandle(fn);
  }
}

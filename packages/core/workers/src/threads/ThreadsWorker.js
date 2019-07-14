// @flow

import type {FilePath} from '@parcel/types';
import type {
  WorkerImpl,
  MessageHandler,
  ErrorHandler,
  ExitHandler
} from '../types';
import {Worker} from 'worker_threads';

export default class ThreadsWorker implements WorkerImpl {
  workerPath: FilePath;
  execArgv: Object;
  onMessage: MessageHandler;
  onError: ErrorHandler;
  onExit: ExitHandler;
  worker: Worker;

  constructor(
    workerPath: FilePath,
    execArgv: Object,
    onMessage: MessageHandler,
    onError: ErrorHandler,
    onExit: ExitHandler
  ) {
    this.workerPath = workerPath;
    this.execArgv = execArgv;
    this.onMessage = onMessage;
    this.onError = onError;
    this.onExit = onExit;
  }

  async start() {
    this.worker = new Worker(this.workerPath, {
      execArgv: this.execArgv,
      env: process.env
    });

    this.worker.on('message', this.onMessage);
    this.worker.on('error', this.onError);
    this.worker.on('exit', this.onExit);

    this.worker.unref();

    return new Promise(resolve => {
      this.worker.on('online', resolve);
    });
  }

  async stop() {
    return this.worker.terminate();
  }

  send(data: Buffer) {
    this.worker.postMessage(data, [data.buffer]);
  }
}

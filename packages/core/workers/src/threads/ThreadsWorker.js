// @flow

import type {
  WorkerImpl,
  MessageHandler,
  ErrorHandler,
  ExitHandler
} from '../types';
import {Worker} from 'worker_threads';
import path from 'path';

const WORKER_PATH = path.join(__dirname, 'ThreadsChild.js');

export default class ThreadsWorker implements WorkerImpl {
  execArgv: Object;
  onMessage: MessageHandler;
  onError: ErrorHandler;
  onExit: ExitHandler;
  worker: Worker;

  constructor(
    execArgv: Object,
    onMessage: MessageHandler,
    onError: ErrorHandler,
    onExit: ExitHandler
  ) {
    this.execArgv = execArgv;
    this.onMessage = onMessage;
    this.onError = onError;
    this.onExit = onExit;
  }

  async start() {
    this.worker = new Worker(WORKER_PATH, {
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

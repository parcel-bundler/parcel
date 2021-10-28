// @flow

import type {
  WorkerImpl,
  MessageHandler,
  ErrorHandler,
  ExitHandler,
  WorkerMessage,
} from '../types';
import {prepareForSerialization, restoreDeserializedObject} from '@parcel/core';

let id = 0;

export default class WebWorker implements WorkerImpl {
  execArgv: Object;
  onMessage: MessageHandler;
  onError: ErrorHandler;
  onExit: ExitHandler;
  worker: Worker;

  constructor(
    execArgv: Object,
    onMessage: MessageHandler,
    onError: ErrorHandler,
    onExit: ExitHandler,
  ) {
    this.execArgv = execArgv;
    this.onMessage = onMessage;
    this.onError = onError;
    this.onExit = onExit;
  }

  start(): Promise<void> {
    // $FlowFixMe[incompatible-call]
    this.worker = new Worker(new URL('./WebChild.js', import.meta.url), {
      name: `Parcel Worker ${id++}`,
      type: 'module',
    });

    // $FlowFixMe ???
    this.worker.onmessage = ({data}) => this.handleMessage(data);
    this.worker.onerror = this.onError;
    // this.worker.on('exit', this.onExit);

    return Promise.resolve();
    // return new Promise<void>(resolve => {
    //   this.worker.on('online', resolve);
    // });
  }

  stop(): Promise<void> {
    this.worker.terminate();
    return Promise.resolve();
  }

  handleMessage(data: WorkerMessage) {
    this.onMessage(restoreDeserializedObject(data));
  }

  send(data: WorkerMessage) {
    this.worker.postMessage(prepareForSerialization(data));
  }
}

// @flow

import type {
  WorkerImpl,
  MessageHandler,
  ErrorHandler,
  ExitHandler,
  WorkerMessage,
} from '../types';
import {prepareForSerialization, restoreDeserializedObject} from '@parcel/core';
import {makeDeferredWithPromise} from '@parcel/utils';

let id = 0;

export default class WebWorker implements WorkerImpl {
  execArgv: Object;
  onMessage: MessageHandler;
  onError: ErrorHandler;
  onExit: ExitHandler;
  worker: Worker;
  stopping: ?Promise<void>;

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

    let {deferred, promise} = makeDeferredWithPromise();

    this.worker.onmessage = ({data}) => {
      if (data === 'online') {
        deferred.resolve();
        return;
      }

      // $FlowFixMe assume WorkerMessage as data
      this.handleMessage(data);
    };
    this.worker.onerror = this.onError;
    // Web workers can't crash or intentionally stop on their own, apart from stop() below
    // this.worker.on('exit', this.onExit);

    return promise;
  }

  stop(): Promise<void> {
    if (!this.stopping) {
      this.stopping = (async () => {
        this.worker.postMessage('stop');
        let {deferred, promise} = makeDeferredWithPromise();
        this.worker.addEventListener('message', ({data}: MessageEvent) => {
          if (data === 'stopped') {
            deferred.resolve();
          }
        });
        await promise;
        this.worker.terminate();
        this.onExit(0);
      })();
    }
    return this.stopping;
  }

  handleMessage(data: WorkerMessage) {
    this.onMessage(restoreDeserializedObject(data));
  }

  send(data: WorkerMessage) {
    this.worker.postMessage(prepareForSerialization(data));
  }
}

// @flow

import type {ChildImpl, MessageHandler, ExitHandler} from '../types';
import {isMainThread, parentPort} from 'worker_threads';
import nullthrows from 'nullthrows';

export default class ThreadsChild implements ChildImpl {
  onMessage: MessageHandler;
  onExit: ExitHandler;

  constructor(onMessage: MessageHandler, onExit: ExitHandler) {
    if (isMainThread || !parentPort) {
      throw new Error('Only create ThreadsChild instances in a worker!');
    }

    this.onMessage = onMessage;
    this.onExit = onExit;
    parentPort.on('message', data => this.onMessage(Buffer.from(data.buffer)));
    parentPort.on('close', this.onExit);
  }

  send(data: Buffer) {
    nullthrows(parentPort).postMessage(data, [data.buffer]);
  }
}

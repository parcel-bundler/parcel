// @flow

import type {ChildImpl, MessageHandler, ExitHandler} from '../types';
import {isMainThread, parentPort} from 'worker_threads';
import nullthrows from 'nullthrows';
import {setChild} from '../childState';
import {Child} from '../child';
import {prepareForSerialization, restoreDeserializedObject} from '@parcel/core';
import type {WorkerMessage} from '@parcel/types';

export default class ThreadsChild implements ChildImpl {
  onMessage: MessageHandler;
  onExit: ExitHandler;

  constructor(onMessage: MessageHandler, onExit: ExitHandler) {
    if (isMainThread || !parentPort) {
      throw new Error('Only create ThreadsChild instances in a worker!');
    }

    this.onMessage = onMessage;
    this.onExit = onExit;
    parentPort.on('message', data => this.handleMessage(data));
    parentPort.on('close', this.onExit);
  }

  handleMessage(data: WorkerMessage) {
    this.onMessage(restoreDeserializedObject(data));
  }

  send(data: WorkerMessage) {
    nullthrows(parentPort).postMessage(prepareForSerialization(data));
  }
}

setChild(new Child(ThreadsChild));

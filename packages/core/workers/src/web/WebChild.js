// @flow
/* eslint-env worker*/

import type {
  ChildImpl,
  MessageHandler,
  ExitHandler,
  WorkerMessage,
} from '../types';
import {setChild} from '../childState';
import {Child} from '../child';
import {prepareForSerialization, restoreDeserializedObject} from '@parcel/core';

export default class WebChild implements ChildImpl {
  onMessage: MessageHandler;
  onExit: ExitHandler;

  constructor(onMessage: MessageHandler, onExit: ExitHandler) {
    if (
      !(
        typeof WorkerGlobalScope !== 'undefined' &&
        self instanceof WorkerGlobalScope
      )
    ) {
      throw new Error('Only create WebChild instances in a worker!');
    }

    // $FlowFixMe ???
    this.onMessage = ({data}) => onMessage(data);
    this.onExit = onExit;
    self.onmessage = data => this.handleMessage(data);
    // parentPort.on('close', this.onExit);
  }

  handleMessage(data: WorkerMessage) {
    this.onMessage(restoreDeserializedObject(data));
  }

  send(data: WorkerMessage) {
    self.postMessage(prepareForSerialization(data));
  }
}

setChild(new Child(WebChild));

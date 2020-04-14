// @flow

import type {FilePath} from '@parcel/types';
import type {WorkerMessage, WorkerImpl, BackendType} from './types';

import EventEmitter from 'events';
import ThrowableDiagnostic from '@parcel/diagnostic';
import {getWorkerBackend} from './backend';

export type WorkerCall = {|
  method?: string,
  handle?: number,
  args: $ReadOnlyArray<any>,
  retries: number,
  resolve: (result: Promise<any> | any) => void,
  reject: (error: any) => void,
|};

type WorkerOpts = {|
  forcedKillTime: number,
  backend: BackendType,
  patchConsole?: boolean,
  sharedReferences: Map<number, mixed>,
|};

let WORKER_ID = 0;
export default class Worker extends EventEmitter {
  +options: WorkerOpts;
  worker: WorkerImpl;
  id: number = WORKER_ID++;
  sharedReferences: Map<number, mixed> = new Map();

  calls: Map<number, WorkerCall> = new Map();
  exitCode = null;
  callId = 0;

  ready = false;
  stopped = false;
  isStopping = false;

  constructor(options: WorkerOpts) {
    super();
    this.options = options;
  }

  async fork(forkModule: FilePath) {
    let filteredArgs = process.execArgv.filter(
      v => !/^--(debug|inspect)/.test(v),
    );

    for (let i = 0; i < filteredArgs.length; i++) {
      let arg = filteredArgs[i];
      if (
        (arg === '-r' || arg === '--require') &&
        filteredArgs[i + 1] === '@parcel/register'
      ) {
        filteredArgs.splice(i, 2);
        i--;
      }
    }

    // Workaround for https://github.com/nodejs/node/issues/29117
    if (process.env.NODE_OPTIONS) {
      let opts = process.env.NODE_OPTIONS.split(' ');
      for (let i = 0; i < opts.length; i++) {
        let opt = opts[i];
        if (opt === '-r' || opt === '--require') {
          filteredArgs.push(opt, opts[i + 1]);
          i++;
        }
      }
    }

    let onMessage = data => this.receive(data);
    let onExit = code => {
      this.exitCode = code;
      this.emit('exit', code);
    };

    let onError = err => {
      this.emit('error', err);
    };

    let WorkerBackend = getWorkerBackend(this.options.backend);
    this.worker = new WorkerBackend(filteredArgs, onMessage, onError, onExit);
    await this.worker.start();

    await new Promise((resolve, reject) => {
      this.call({
        method: 'childInit',
        args: [
          forkModule,
          {
            patchConsole: !!this.options.patchConsole,
          },
        ],
        retries: 0,
        resolve,
        reject,
      });
    });

    let sharedRefs = this.options.sharedReferences;
    let refsShared = new Set();
    // in case more refs are created while initial refs are sending
    while (refsShared.size < sharedRefs.size) {
      await Promise.all(
        [...sharedRefs]
          .filter(([ref]) => !refsShared.has(ref))
          .map(async ([ref, value]) => {
            await this.sendSharedReference(ref, value);
            refsShared.add(ref);
          }),
      );
    }

    this.ready = true;
    this.emit('ready');
  }

  sendSharedReference(ref: number, value: mixed) {
    new Promise((resolve, reject) => {
      this.call({
        method: 'createSharedReference',
        args: [ref, value],
        resolve,
        reject,
        retries: 0,
      });
    });
  }

  send(data: WorkerMessage): void {
    this.worker.send(data);
  }

  call(call: WorkerCall): void {
    if (this.stopped || this.isStopping) {
      return;
    }

    let idx = this.callId++;
    this.calls.set(idx, call);

    this.send({
      type: 'request',
      idx: idx,
      child: this.id,
      handle: call.handle,
      method: call.method,
      args: call.args,
    });
  }

  receive(message: WorkerMessage): void {
    if (this.stopped || this.isStopping) {
      return;
    }

    if (message.type === 'request') {
      this.emit('request', message);
    } else if (message.type === 'response') {
      let idx = message.idx;
      if (idx == null) {
        return;
      }

      let call = this.calls.get(idx);
      if (!call) {
        // Return for unknown calls, these might accur if a third party process uses workers
        return;
      }

      if (message.contentType === 'error') {
        call.reject(new ThrowableDiagnostic({diagnostic: message.content}));
      } else {
        call.resolve(message.content);
      }

      this.calls.delete(idx);
      this.emit('response', message);
    }
  }

  async stop() {
    if (!this.stopped) {
      this.stopped = true;

      if (this.worker) {
        await this.worker.stop();
      }
    }
  }
}

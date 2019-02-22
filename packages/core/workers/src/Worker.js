// @flow

import type {FilePath} from '@parcel/types';
import type {BundlerOptions, WorkerMessage} from './types';

import childProcess, {type ChildProcess} from 'child_process';
import EventEmitter from 'events';
import {jsonToError} from '@parcel/utils/src/errorUtils';
import {serialize, deserialize} from '@parcel/utils/src/serializer';

const childModule = require.resolve('./child');

export type WorkerCall = {|
  method: string,
  args: Array<any>,
  retries: number,
  resolve: (result: Promise<any> | any) => void,
  reject: (error: any) => void
|};

type WorkerOpts = {|
  forcedKillTime: number
|};

let WORKER_ID = 0;
export default class Worker extends EventEmitter {
  +options: WorkerOpts;
  child: ChildProcess;
  id: number = WORKER_ID++;
  processQueue: boolean = true;
  sendQueue: Array<any> = [];

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

  async fork(forkModule: FilePath, bundlerOptions: BundlerOptions) {
    let filteredArgs = process.execArgv.filter(
      v => !/^--(debug|inspect)/.test(v)
    );

    this.child = childProcess.fork(childModule, process.argv, {
      execArgv: filteredArgs,
      env: process.env,
      cwd: process.cwd()
    });

    // TODO: This was causing odd behavior, need to fix
    // // Unref the child and IPC channel so that the workers don't prevent the main process from exiting
    // this.child.unref();
    // this.child.channel.unref();

    this.child.on('message', data => this.receive(data));

    this.child.once('exit', code => {
      this.exitCode = code;
      this.emit('exit', code);
    });

    this.child.on('error', err => {
      this.emit('error', err);
    });

    await new Promise((resolve, reject) => {
      this.call({
        method: 'childInit',
        args: [forkModule],
        retries: 0,
        resolve,
        reject
      });
    });

    await this.init(bundlerOptions);
  }

  async init(bundlerOptions: BundlerOptions) {
    this.ready = false;

    return new Promise((resolve, reject) => {
      this.call({
        method: 'init',
        args: [bundlerOptions],
        retries: 0,
        resolve: (...args) => {
          this.ready = true;
          this.emit('ready');
          resolve(...args);
        },
        reject
      });
    });
  }

  send(data: WorkerMessage): void {
    if (!this.processQueue) {
      this.sendQueue.push(data);
      return;
    }

    let result = this.child.send(serialize(data), error => {
      if (error && error instanceof Error) {
        // Ignore this, the workerfarm handles child errors
        return;
      }

      this.processQueue = true;

      if (this.sendQueue.length > 0) {
        let queueCopy = this.sendQueue.slice(0);
        this.sendQueue = [];
        queueCopy.forEach(entry => this.send(entry));
      }
    });

    if (!result || /^win/.test(process.platform)) {
      // Queue is handling too much messages throttle it
      this.processQueue = false;
    }
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
      method: call.method,
      args: call.args
    });
  }

  receive(data: string): void {
    if (this.stopped || this.isStopping) {
      return;
    }

    let message: WorkerMessage = deserialize(data);

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
        call.reject(jsonToError(message.content));
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

      if (this.child) {
        this.child.send('die');

        let forceKill = setTimeout(
          () => this.child.kill('SIGINT'),
          this.options.forcedKillTime
        );
        await new Promise(resolve => {
          this.child.once('exit', resolve);
        });

        clearTimeout(forceKill);
      }
    }
  }
}

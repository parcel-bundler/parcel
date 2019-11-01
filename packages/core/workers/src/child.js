// @flow

import type {
  CallRequest,
  WorkerDataResponse,
  WorkerErrorResponse,
  WorkerMessage,
  WorkerRequest,
  WorkerResponse,
  ChildImpl
} from './types';
import type {IDisposable} from '@parcel/types';
import type {WorkerApi} from './WorkerFarm';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import Logger, {patchConsole} from '@parcel/logger';
import ThrowableDiagnostic, {anyToDiagnostic} from '@parcel/diagnostic';
import bus from './bus';
import Profiler from './Profiler';
import Handle from './Handle';

type ChildCall = WorkerRequest & {|
  resolve: (result: Promise<any> | any) => void,
  reject: (error: any) => void
|};

export class Child {
  callQueue: Array<ChildCall> = [];
  childId: ?number;
  maxConcurrentCalls: number = 10;
  module: ?any;
  responseId = 0;
  responseQueue: Map<number, ChildCall> = new Map();
  loggerDisposable: IDisposable;
  child: ChildImpl;
  profiler: ?Profiler;
  workerApi: WorkerApi;
  handles: Map<number, Handle> = new Map();
  sharedReferences: Map<number, mixed> = new Map();

  constructor(ChildBackend: Class<ChildImpl>) {
    this.child = new ChildBackend(
      this.messageListener.bind(this),
      this.handleEnd.bind(this)
    );

    // Monitior all logging events inside this child process and forward to
    // the main process via the bus.
    this.loggerDisposable = Logger.onLog(event => {
      bus.emit('logEvent', event);
    });
  }

  workerApi = {
    callMaster: (
      request: CallRequest,
      awaitResponse: ?boolean = true
    ): Promise<mixed> => this.addCall(request, awaitResponse),
    createReverseHandle: (fn: (...args: Array<any>) => mixed): Handle =>
      this.createReverseHandle(fn),
    getSharedReference: (ref: number) => this.sharedReferences.get(ref)
  };

  messageListener(message: WorkerMessage): void | Promise<void> {
    if (message.type === 'response') {
      return this.handleResponse(message);
    } else if (message.type === 'request') {
      return this.handleRequest(message);
    }
  }

  send(data: WorkerMessage): void {
    this.child.send(data);
  }

  childInit(module: string, childId: number): void {
    // $FlowFixMe this must be dynamic
    this.module = require(module);
    this.childId = childId;
  }

  async handleRequest(data: WorkerRequest): Promise<void> {
    let {idx, method, args, handle: handleId} = data;
    let child = nullthrows(data.child);

    const responseFromContent = (content: any): WorkerDataResponse => ({
      idx,
      child,
      type: 'response',
      contentType: 'data',
      content
    });

    const errorResponseFromError = (e: Error): WorkerErrorResponse => ({
      idx,
      child,
      type: 'response',
      contentType: 'error',
      content: anyToDiagnostic(e)
    });

    let result;
    if (handleId != null) {
      try {
        let fn = nullthrows(this.handles.get(handleId)).fn;
        result = responseFromContent(fn(...args));
      } catch (e) {
        result = errorResponseFromError(e);
      }
    } else if (method === 'childInit') {
      try {
        let [moduleName, childOptions] = args;
        if (childOptions.patchConsole) {
          patchConsole();
        }

        result = responseFromContent(this.childInit(moduleName, child));
      } catch (e) {
        result = errorResponseFromError(e);
      }
    } else if (method === 'startProfile') {
      this.profiler = new Profiler();
      try {
        result = responseFromContent(await this.profiler.startProfiling());
      } catch (e) {
        result = errorResponseFromError(e);
      }
    } else if (method === 'endProfile') {
      try {
        let res = this.profiler ? await this.profiler.stopProfiling() : null;
        result = responseFromContent(res);
      } catch (e) {
        result = errorResponseFromError(e);
      }
    } else if (method === 'createSharedReference') {
      this.sharedReferences.set(args[0], args[1]);
      result = responseFromContent(null);
    } else if (method === 'deleteSharedReference') {
      this.sharedReferences.delete(args[0]);
      result = responseFromContent(null);
    } else {
      try {
        result = responseFromContent(
          // $FlowFixMe
          await this.module[method](this.workerApi, ...args)
        );
      } catch (e) {
        result = errorResponseFromError(e);
      }
    }

    this.send(result);
  }

  handleResponse(data: WorkerResponse): void {
    let idx = nullthrows(data.idx);
    let contentType = data.contentType;
    let content = data.content;
    let call = nullthrows(this.responseQueue.get(idx));

    if (contentType === 'error') {
      invariant(typeof content !== 'string');
      call.reject(new ThrowableDiagnostic({diagnostic: content}));
    } else {
      call.resolve(content);
    }

    this.responseQueue.delete(idx);

    // Process the next call
    this.processQueue();
  }

  // Keep in mind to make sure responses to these calls are JSON.Stringify safe
  addCall(
    request: CallRequest,
    awaitResponse: ?boolean = true
  ): Promise<mixed> {
    // $FlowFixMe
    let call: ChildCall = {
      ...request,
      type: 'request',
      child: this.childId,
      awaitResponse,
      resolve: () => {},
      reject: () => {}
    };

    let promise;
    if (awaitResponse) {
      promise = new Promise((resolve, reject) => {
        call.resolve = resolve;
        call.reject = reject;
      });
    }

    this.callQueue.push(call);
    this.processQueue();

    return promise ?? Promise.resolve();
  }

  sendRequest(call: ChildCall): void {
    let idx;
    if (call.awaitResponse) {
      idx = this.responseId++;
      this.responseQueue.set(idx, call);
    }

    this.send({
      idx,
      child: call.child,
      type: call.type,
      location: call.location,
      handle: call.handle,
      method: call.method,
      args: call.args,
      awaitResponse: call.awaitResponse
    });
  }

  processQueue(): void {
    if (!this.callQueue.length) {
      return;
    }

    if (this.responseQueue.size < this.maxConcurrentCalls) {
      this.sendRequest(this.callQueue.shift());
    }
  }

  handleEnd(): void {
    this.loggerDisposable.dispose();
  }

  createReverseHandle(fn: (...args: Array<any>) => mixed) {
    let handle = new Handle({
      fn,
      workerApi: this.workerApi,
      childId: this.childId
    });
    this.handles.set(handle.id, handle);
    return handle;
  }
}

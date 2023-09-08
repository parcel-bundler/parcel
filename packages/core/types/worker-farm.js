// @flow
import type {Diagnostic} from '@parcel/diagnostic';
import type {ErrorWithCode, FilePath} from './index';

export opaque type SharedReference = number;

export function createSharedReference(id: number): SharedReference {
  return id;
}

export type WorkerCall = {|
  method?: string,
  handle?: number,
  args: $ReadOnlyArray<any>,
  retries: number,
  skipReadyCheck?: boolean,
  resolve: (result: Promise<any> | any) => void,
  reject: (error: any) => void,
|};

// $FlowFixMe
export type HandleFunction = (...args: Array<any>) => any;

export type HandleOpts = {|
  fn?: HandleFunction,
  childId?: ?number,
  id?: number,
|};

export interface Handle {
  id: number;
  childId: ?number;
  dispose(): void;
  serialize(): {|childId: ?number, id: number|};
}

export type LocationCallRequest = {|
  args: $ReadOnlyArray<mixed>,
  location: string,
  method?: string,
|};

export type HandleCallRequest = {|
  args: $ReadOnlyArray<mixed>,
  handle: number,
|};

export type CallRequest = LocationCallRequest | HandleCallRequest;

export type WorkerAPI = {|
  callChild: (childId: number, request: HandleCallRequest) => Promise<mixed>,
  callMaster: (
    request: CallRequest,
    awaitResponse?: ?boolean,
  ) => Promise<mixed>,
  createReverseHandle: (fn: HandleFunction) => Handle,
  getSharedReference: (ref: SharedReference) => mixed,
  resolveSharedReference: (value: mixed) => void | SharedReference,
  runHandle: (handle: Handle, args: Array<any>) => Promise<mixed>,
|};
export interface WorkerFarm {
  ending: boolean;
  workerApi: WorkerAPI;
  warmupWorker(method: string, args: Array<any>): void;
  shouldStartRemoteWorkers(): boolean;
  createHandle(method: string, useMainThread?: boolean): HandleFunction;
  onError(error: ErrorWithCode, worker: Worker): void | Promise<void>;
  startChild(): void;
  stopWorker(worker: Worker): Promise<void>;
  processQueue(): void;
  callWorker(worker: Worker, call: WorkerCall): Promise<void>;
  processRequest(
    data: {|
      location: FilePath,
    |} & $Shape<WorkerRequest>,
    worker?: Worker,
  ): Promise<?string>;
  addCall(method: string, args: Array<any>): Promise<any>;
  end(): Promise<void>;
  startMaxWorkers(): void;
  shouldUseRemoteWorkers(): boolean;
  createReverseHandle(fn: HandleFunction): Handle;
  createSharedReference(
    value: mixed,
    isCacheable?: boolean,
  ): {|ref: SharedReference, dispose(): Promise<mixed>|};
  getSerializedSharedReference(ref: SharedReference): ArrayBuffer;
  startProfile(): Promise<void>;
  endProfile(): Promise<void>;
  callAllWorkers(method: string, args: Array<any>): Promise<void>;
  takeHeapSnapshot(): Promise<void>;
}

export type WorkerDataResponse = {|
  idx?: number,
  child?: number,
  type: 'response',
  contentType: 'data',
  content: string,
|};

export type WorkerErrorResponse = {|
  idx?: number,
  child?: number,
  type: 'response',
  contentType: 'error',
  content: Diagnostic | Array<Diagnostic>,
|};

export type WorkerRequest = {|
  args: $ReadOnlyArray<any>,
  awaitResponse?: boolean,
  child?: ?number,
  idx?: number,
  location?: FilePath,
  method?: ?string,
  type: 'request',
  handle?: number,
|};
export type WorkerResponse = WorkerDataResponse | WorkerErrorResponse;
export type WorkerMessage = WorkerRequest | WorkerResponse;

export interface Worker {
  id: number;
  calls: Map<number, WorkerCall>;
  sentSharedReferences: Set<SharedReference>;
  ready: boolean;
  stopped: boolean;
  isStopping: boolean;
  fork(forkModule: FilePath): Promise<void>;
  sendSharedReference(ref: SharedReference, value: mixed): Promise<any>;
  send(data: WorkerMessage): void;
  call(call: WorkerCall): void;
  receive(message: WorkerMessage): void;
  stop(): Promise<void>;
}

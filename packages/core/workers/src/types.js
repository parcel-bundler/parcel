// @flow

import type {Config, FilePath, ParcelOptions} from '@parcel/types';
import type {JSONError} from '@parcel/utils';

export type BundlerOptions = {|
  options: ParcelOptions,
  config: Config,
  env: ?{[string]: ?string}
|};

export type CallRequest = {|
  args: $ReadOnlyArray<mixed>,
  location: string,
  method?: string
|};

export type WorkerRequest = {|
  args: Array<any>,
  awaitResponse?: boolean,
  child?: ?number,
  idx?: number,
  location?: FilePath,
  method?: ?string,
  type: 'request',
  handle?: number
|};

export type WorkerDataResponse = {|
  idx?: number,
  child?: number,
  type: 'response',
  contentType: 'data',
  content: string
|};

export type WorkerErrorResponse = {|
  idx?: number,
  child?: number,
  type: 'response',
  contentType: 'error',
  content: JSONError
|};

export type WorkerResponse = WorkerDataResponse | WorkerErrorResponse;
export type WorkerMessage = WorkerRequest | WorkerResponse;

export type MessageHandler = (data: WorkerMessage) => void;
export type ErrorHandler = (err: Error) => void;
export type ExitHandler = (code: number) => void;
export interface WorkerImpl {
  constructor(
    execArgv: Object,
    onMessage: MessageHandler,
    onError: ErrorHandler,
    onExit: ExitHandler
  ): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(data: WorkerMessage): void;
}

export interface ChildImpl {
  constructor(onMessage: MessageHandler, onExit: ExitHandler): void;
  send(data: WorkerMessage): void;
}

export type BackendType = 'threads' | 'process';

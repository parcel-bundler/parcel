// @flow

import type {CLIOptions, Config, FilePath} from '@parcel/types';

export type BundlerOptions = {|
  cliOpts: CLIOptions,
  config: Config,
  env: ?{[string]: ?string}
|};

export type CallRequest = {|
  args: Array<any>,
  location: string,
  method?: string
|};

export type WorkerRequest = {|
  args: Array<any>,
  awaitResponse?: boolean,
  child?: number,
  idx?: number,
  location?: FilePath,
  method?: ?string,
  type: 'request'
|};

export type WorkerDataResponse = {|
  idx?: number,
  child?: number,
  type: 'response',
  contentType: 'data',
  content: ?string
|};

export type WorkerErrorResponse = {|
  idx?: number,
  child?: number,
  type: 'response',
  contentType: 'error',
  content: ?string
|};

export type WorkerResponse = WorkerDataResponse | WorkerErrorResponse;
export type WorkerMessage = WorkerRequest | WorkerResponse;

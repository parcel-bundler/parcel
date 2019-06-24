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

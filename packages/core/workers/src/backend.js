// @flow
import type {BackendType, WorkerImpl} from './types';

import WebWorker from './web/WebWorker';

export function detectBackend(): BackendType {
  // $FlowFixMe
  if (process.browser) return 'web';

  switch (process.env.PARCEL_WORKER_BACKEND) {
    case 'threads':
    case 'process':
      return process.env.PARCEL_WORKER_BACKEND;
  }

  try {
    require('worker_threads');
    return 'threads';
  } catch (err) {
    return 'process';
  }
}

export function getWorkerBackend(backend: BackendType): Class<WorkerImpl> {
  switch (backend) {
    case 'threads':
      return require('./threads/ThreadsWorker').default;
    case 'web':
      return WebWorker;
    case 'process':
      return require('./process/ProcessWorker').default;
    default:
      throw new Error(`Invalid backend: ${backend}`);
  }
}

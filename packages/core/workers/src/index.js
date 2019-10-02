// @flow
import type {LogEvent} from '@parcel/types';
import invariant from 'assert';
import WorkerFarm from './WorkerFarm';
import Logger from '@parcel/logger';
import bus from './bus';

if (!WorkerFarm.isWorker()) {
  // Forward all logger events originating from workers into the main process
  bus.on('logEvent', (e: LogEvent) => {
    switch (e.level) {
      case 'info':
        invariant(typeof e.message === 'string');
        Logger.info(e.message);
        break;
      case 'progress':
        invariant(typeof e.message === 'string');
        Logger.progress(e.message);
        break;
      case 'verbose':
        invariant(typeof e.message === 'string');
        Logger.verbose(e.message);
        break;
      case 'warn':
        Logger.warn(e.message);
        break;
      case 'error':
        Logger.error(e.message);
        break;
      default:
        throw new Error('Unknown log level');
    }
  });
}

export default WorkerFarm;
export {bus};
export {Handle} from './WorkerFarm';
export type {WorkerApi, FarmOptions} from './WorkerFarm';

// @flow
import type {TraceEvent, LogEvent} from '@atlaspack/types-internal';
import invariant from 'assert';
import WorkerFarm from './WorkerFarm';
import Logger from '@atlaspack/logger';
import bus from './bus';
import {tracer} from '@atlaspack/profiler';

if (!WorkerFarm.isWorker()) {
  // Forward all logger events originating from workers into the main process
  bus.on('logEvent', (e: LogEvent) => {
    switch (e.level) {
      case 'info':
        Logger.info(e.diagnostics);
        break;
      case 'progress':
        invariant(typeof e.message === 'string');
        Logger.progress(e.message);
        break;
      case 'verbose':
        Logger.verbose(e.diagnostics);
        break;
      case 'warn':
        Logger.warn(e.diagnostics);
        break;
      case 'error':
        Logger.error(e.diagnostics);
        break;
      default:
        throw new Error('Unknown log level');
    }
  });

  // Forward all trace events originating from workers into the main process
  bus.on('traceEvent', (e: TraceEvent) => {
    tracer.trace(e);
  });
}

export default WorkerFarm;
export {bus};
export {Handle} from './WorkerFarm';
export type {WorkerApi, FarmOptions, SharedReference} from './WorkerFarm';

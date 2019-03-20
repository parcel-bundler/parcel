// @flow strict-local

import WorkerFarm from '@parcel/workers';
import invariant from 'assert';
import EventEmitter from 'events';
import {inspect} from 'util';

class Logger extends EventEmitter {
  verbose(message: string): void {
    this.emit('log', {
      type: 'log',
      level: 'verbose',
      message
    });
  }

  info(message: string): void {
    this.log(message);
  }

  log(message: string): void {
    this.emit('log', {
      type: 'log',
      level: 'info',
      message
    });
  }

  warn(err: string): void {
    this.emit('log', {
      type: 'log',
      level: 'warn',
      message: err
    });
  }

  error(err: Error | string): void {
    this.emit('log', {
      type: 'log',
      level: 'error',
      message: err
    });
  }

  progress(message: string): void {
    this.emit('log', {
      type: 'log',
      level: 'progress',
      message
    });
  }
}

// If we are in a worker, make a proxy class which will
// send the logger calls to the main process via IPC.
// These are handled in WorkerFarm and directed to handleMessage above.
let logger;
if (WorkerFarm.isWorker()) {
  class LoggerProxy {}
  for (let method of Object.getOwnPropertyNames(Logger.prototype)) {
    // $FlowFixMe
    LoggerProxy.prototype[method] = (...args) => {
      WorkerFarm.callMaster(
        {
          location: __filename,
          method,
          args
        },
        false
      );
    };
  }

  // eslint-disable-next-line
  logger: Logger = new LoggerProxy();
} else {
  logger = new Logger();
}

invariant(logger != null);

/* eslint-disable no-console */
// $FlowFixMe
console.log = (...messages: Array<mixed>) => {
  logger.info(messages.map(m => inspect(m)).join(' '));
};

// $FlowFixMe
console.warn = message => {
  logger.warn(message);
};

// $FlowFixMe
console.error = message => {
  logger.error(message);
};
/* eslint-enable no-console */

export default logger;

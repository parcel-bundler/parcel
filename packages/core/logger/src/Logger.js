const WorkerFarm = require('@parcel/workers');
const EventEmitter = require('events');
const inspect = require('util').inspect;

class Logger extends EventEmitter {
  verbose(message) {
    this.emit('log', {
      type: 'log',
      level: 'verbose',
      message
    });
  }

  info(...args) {
    let messages = args.map(arg => {
      if (typeof arg !== 'string') {
        arg = inspect(arg, {colors: true, depth: 50});
      }

      return arg;
    });

    this.emit('log', {
      type: 'log',
      level: 'info',
      message: messages.join(' ')
    });
  }

  warn(err) {
    this.emit('log', {
      type: 'log',
      level: 'warn',
      message: err
    });
  }

  error(err) {
    this.emit('log', {
      type: 'log',
      level: 'error',
      message: err
    });
  }

  progress(message) {
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
if (WorkerFarm.isWorker()) {
  class LoggerProxy {}
  for (let method of Object.getOwnPropertyNames(Logger.prototype)) {
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

  module.exports = new LoggerProxy();
} else {
  module.exports = new Logger();
}

let logger = module.exports;

// eslint-disable-next-line no-console
// console.log = (...args) => {
//   logger.info(...args);
// };

// // eslint-disable-next-line no-console
// console.warn = (...args) => {
//   logger.warn(...args);
// };

// // eslint-disable-next-line no-console
// console.error = (...args) => {
//   logger.error(...args);
// };

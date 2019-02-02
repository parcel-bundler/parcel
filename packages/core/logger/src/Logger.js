const WorkerFarm = require('@parcel/workers');
const EventEmitter = require('events');

class Logger extends EventEmitter {
  verbose(message) {
    this.emit('log', {
      type: 'log',
      level: 'verbose',
      message
    });
  }

  log(message) {
    this.emit('log', {
      type: 'log',
      level: 'info',
      message
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

  handleMessage(options) {
    this[options.method](...options.args);
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

const {countBreaks} = require('grapheme-breaker');
const stripAnsi = require('strip-ansi');
const WorkerFarm = require('@parcel/workers');
const EventEmitter = require('events');

class Logger extends EventEmitter {
  constructor(options) {
    super();
    this.warnings = new Set();
    this.setOptions(options);
  }

  setOptions(options) {
    this.logLevel =
      options && isNaN(options.logLevel) === false
        ? Number(options.logLevel)
        : 3;
  }

  verbose(message) {
    if (this.logLevel < 4) {
      return;
    }

    this.emit('log', {
      type: 'log',
      level: 'verbose',
      message
    });
  }

  log(message) {
    if (this.logLevel < 3) {
      return;
    }

    this.emit('log', {
      type: 'log',
      level: 'info',
      message
    });
  }

  warn(err) {
    if (this.logLevel < 2 || this.warnings.has(err)) {
      return;
    }

    this.warnings.add(err);
    this.emit('log', {
      type: 'log',
      level: 'warn',
      message: err
    });
  }

  error(err) {
    if (this.logLevel < 1) {
      return;
    }

    this.emit('log', {
      type: 'log',
      level: 'error',
      message: err
    });
  }

  handleMessage(options) {
    this[options.method](...options.args);
  }

  table(columns, table) {
    // Measure column widths
    let colWidths = [];
    for (let row of table) {
      let i = 0;
      for (let item of row) {
        colWidths[i] = Math.max(colWidths[i] || 0, stringWidth(item));
        i++;
      }
    }

    // Render rows
    for (let row of table) {
      let items = row.map((item, i) => {
        // Add padding between columns unless the alignment is the opposite to the
        // next column and pad to the column width.
        let padding =
          !columns[i + 1] || columns[i + 1].align === columns[i].align ? 4 : 0;
        return pad(item, colWidths[i] + padding, columns[i].align);
      });

      this.log(items.join(''));
    }
  }
}

// Pad a string with spaces on either side
function pad(text, length, align = 'left') {
  let pad = ' '.repeat(length - stringWidth(text));
  if (align === 'right') {
    return pad + text;
  }

  return text + pad;
}

// Count visible characters in a string
function stringWidth(string) {
  return countBreaks(stripAnsi('' + string));
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

const chalk = require('chalk');
const readline = require('readline');
const prettyError = require('./utils/prettyError');
const emoji = require('./utils/emoji');
const {countBreaks} = require('grapheme-breaker');
const stripAnsi = require('strip-ansi');
const ora = require('ora');
const WorkerFarm = require('./workerfarm/WorkerFarm');
const path = require('path');
const fs = require('fs');

class Logger {
  constructor(options) {
    this.lines = 0;
    this.spinner = null;
    this.setOptions(options);
  }

  setOptions(options) {
    this.logLevel =
      options && isNaN(options.logLevel) === false
        ? Number(options.logLevel)
        : 3;
    this.color =
      options && typeof options.color === 'boolean'
        ? options.color
        : chalk.supportsColor;
    this.chalk = new chalk.constructor({enabled: this.color});
    this.isTest =
      options && typeof options.isTest === 'boolean'
        ? options.isTest
        : process.env.NODE_ENV === 'test';
  }

  countLines(message) {
    return stripAnsi(message)
      .split('\n')
      .reduce((p, line) => {
        if (process.stdout.columns) {
          return p + Math.ceil((line.length || 1) / process.stdout.columns);
        }

        return p + 1;
      }, 0);
  }

  writeRaw(message) {
    this.stopSpinner();

    this.lines += this.countLines(message) - 1;
    process.stdout.write(message);
  }

  write(message, persistent = false) {
    if (this.logLevel > 3) {
      return this.verbose(message);
    }

    if (!persistent) {
      this.lines += this.countLines(message);
    }

    this.stopSpinner();
    this._log(message);
  }

  verbose(message) {
    if (this.logLevel < 4) {
      return;
    }

    let currDate = new Date();
    message = `[${currDate.toLocaleTimeString()}]: ${message}`;
    if (this.logLevel > 4) {
      if (!this.logFile) {
        this.logFile = fs.createWriteStream(
          path.join(
            process.cwd(),
            `parcel-debug-${currDate.toLocaleDateString()}@${currDate.toLocaleTimeString()}.log`
          )
        );
      }
      this.logFile.write(stripAnsi(message) + '\n');
    }
    this._log(message);
  }

  log(message) {
    if (this.logLevel < 3) {
      return;
    }

    this.write(message);
  }

  persistent(message) {
    if (this.logLevel < 3) {
      return;
    }

    this.write(this.chalk.bold(message), true);
  }

  warn(err) {
    if (this.logLevel < 2) {
      return;
    }

    this._writeError(err, emoji.warning, this.chalk.yellow);
  }

  error(err) {
    if (this.logLevel < 1) {
      return;
    }

    this._writeError(err, emoji.error, this.chalk.red.bold);
  }

  success(message) {
    this.log(`${emoji.success}  ${this.chalk.green.bold(message)}`);
  }

  _writeError(err, emoji, color) {
    let {message, stack} = prettyError(err, {color: this.color});
    this.write(color(`${emoji}  ${message}`));
    if (stack) {
      this.write(stack);
    }
  }

  clear() {
    if (!this.color || this.isTest || this.logLevel > 3) {
      return;
    }

    while (this.lines > 0) {
      readline.clearLine(process.stdout, 0);
      readline.moveCursor(process.stdout, 0, -1);
      this.lines--;
    }

    readline.cursorTo(process.stdout, 0);
    this.stopSpinner();
  }

  progress(message) {
    if (this.logLevel < 3) {
      return;
    }

    if (this.logLevel > 3) {
      return this.verbose(message);
    }

    let styledMessage = this.chalk.gray.bold(message);
    if (!this.spinner) {
      this.spinner = ora({
        text: styledMessage,
        stream: process.stdout,
        enabled: this.isTest ? false : undefined // fall back to ora default unless we need to explicitly disable it.
      }).start();
    } else {
      this.spinner.text = styledMessage;
    }
  }

  stopSpinner() {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  handleMessage(options) {
    this[options.method](...options.args);
  }

  _log(message) {
    console.log(message);
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

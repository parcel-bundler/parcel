const chalk = require('chalk');
const readline = require('readline');
const prettyError = require('./utils/prettyError');
const emoji = require('./utils/emoji');
const {countBreaks} = require('grapheme-breaker');
const stripAnsi = require('strip-ansi');

class Logger {
  constructor(options) {
    this.lines = 0;
    this.statusLine = null;
    this.setOptions(options);
  }

  setOptions(options) {
    this.logLevel =
      options && typeof options.logLevel === 'number' ? options.logLevel : 3;
    this.color =
      options && typeof options.color === 'boolean'
        ? options.color
        : chalk.supportsColor;
    this.chalk = new chalk.constructor({enabled: this.color});
  }

  write(message, persistent = false) {
    if (!persistent) {
      this.lines += message.split('\n').length;
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

    let {message, stack} = prettyError(err, {color: this.color});
    this.write(this.chalk.yellow(`${emoji.warning}  ${message}`));
    if (stack) {
      this.write(stack);
    }
  }

  error(err) {
    if (this.logLevel < 1) {
      return;
    }

    let {message, stack} = prettyError(err, {color: this.color});

    this.status(emoji.error, message, 'red');
    if (stack) {
      this.write(stack);
    }
  }

  clear() {
    if (!this.color) {
      return;
    }

    while (this.lines > 0) {
      readline.clearLine(process.stdout, 0);
      readline.moveCursor(process.stdout, 0, -1);
      this.lines--;
    }

    readline.cursorTo(process.stdout, 0);
    this.statusLine = null;
  }

  writeLine(line, msg) {
    if (!this.color) {
      return this.log(msg);
    }

    let n = this.lines - line;
    let stdout = process.stdout;
    readline.cursorTo(stdout, 0);
    readline.moveCursor(stdout, 0, -n);
    stdout.write(msg);
    readline.clearLine(stdout, 1);
    readline.cursorTo(stdout, 0);
    readline.moveCursor(stdout, 0, n);
  }

  status(emoji, message, color = 'gray') {
    if (this.logLevel < 3) {
      return;
    }

    let hasStatusLine = this.statusLine != null;
    if (!hasStatusLine) {
      this.statusLine = this.lines;
    }

    this.writeLine(
      this.statusLine,
      this.chalk[color].bold(`${emoji}  ${message}`)
    );

    if (!hasStatusLine) {
      process.stdout.write('\n');
      this.lines++;
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
if (process.send) {
  class LoggerProxy {}
  for (let method of Object.getOwnPropertyNames(Logger.prototype)) {
    LoggerProxy.prototype[method] = (...args) => {
      process.send({
        type: 'logger',
        method,
        args
      });
    };
  }

  module.exports = new LoggerProxy();
} else {
  module.exports = new Logger();
}

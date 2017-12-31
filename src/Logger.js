const chalk = require('chalk');
const readline = require('readline');
const prettyError = require('./utils/prettyError');
const emoji = require('./utils/emoji');

class Logger {
  constructor(options) {
    this.messages = [
      {
        type: 'status',
        persistent: true,
        content: 'Parcel bundler'
      }
    ];
    this.updateOptions(options);
    this.written = 0;
  }

  updateOptions(options) {
    this.logLevel =
      options && typeof options.logLevel === 'number' ? options.logLevel : 3;
    this.color =
      options && typeof options.color === 'boolean'
        ? options.color
        : chalk.supportsColor;
    this.chalk = new chalk.constructor({enabled: this.color});
  }

  write(message, persistent = false, type = 'log') {
    message.split('\n').forEach(content => {
      if (content !== '') {
        this.writeLine(
          this.messages.push({
            type: type,
            persistent: persistent,
            content: content
          }) - 1
        );
      }
    });
  }

  writeLine(line) {
    if (!this.messages[line]) return;
    let stdout = process.stdout;
    let msg = this.messages[line].content;
    if (!this.color || !stdout.isTTY) {
      return console.log(msg);
    }

    line = line + 1;
    let n = line - this.written;
    readline.cursorTo(stdout, 0);
    readline.moveCursor(stdout, 0, n);

    readline.clearLine(stdout, 0);
    stdout.write(msg);

    n = this.written > line ? this.written - line : 0;
    readline.cursorTo(stdout, 0);
    readline.moveCursor(stdout, 0, n);
    this.written += this.written < line ? 1 : 0;
  }

  clear() {
    if (!this.color || this.logLevel === 0) {
      return;
    }

    readline.cursorTo(process.stdout, 0);
    readline.moveCursor(process.stdout, 0, -this.messages.length);
    readline.clearScreenDown(process.stdout);
    this.messages = this.messages.filter(
      message => message.type === 'status' || message.persistent === true
    );
    this.written = 0;
    this.messages.forEach((message, index) => {
      this.writeLine(index);
    });
  }

  log(message, persistent = false) {
    if (this.logLevel < 3) {
      return;
    }

    this.write(message, persistent);
  }

  warn(message, persistent = false) {
    if (this.logLevel < 2) {
      return;
    }

    this.write(this.chalk.yellow(message), persistent, 'warning');
  }

  error(err, persistent = false) {
    if (this.logLevel < 1) {
      return;
    }

    let {message, stack} = prettyError(err, {color: this.color});

    this.status(emoji.error, message, 'red');
    if (stack) {
      this.write(
        `${emoji.error} ${this.chalk['red'].bold(message)}`,
        persistent,
        'error'
      );
      this.write(stack, persistent, 'error');
    }
  }

  status(emoji, message, color = 'gray') {
    if (this.logLevel < 3) {
      return;
    }

    this.messages[0].content = this.chalk[color].bold(`${emoji}  ${message}`);

    this.writeLine(0);
  }

  persistent(message) {
    this.log(this.chalk.bold(message), true);
  }

  handleMessage(options) {
    this[options.method](...options.args);
  }
}

let loggerInstance;
function getLogger() {
  if (!loggerInstance) {
    loggerInstance = new Logger();
  }
  return loggerInstance;
}

module.exports = Logger;
module.exports.instance = getLogger();

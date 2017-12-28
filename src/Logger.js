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
    this.lines = 0;
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
        this.messages.push({
          type: type,
          persistent: persistent,
          content: content
        });
        this.clear(false);
      }
    });
  }

  writeLine(line) {
    if (!this.messages[line]) return;
    let msg = this.messages[line].content;
    if (!this.color || !process.stdout.isTTY) {
      return console.log(msg);
    }

    let stdout = process.stdout;
    readline.cursorTo(stdout, 0);
    stdout.write(msg);
    readline.cursorTo(stdout, 0);
    readline.moveCursor(stdout, 0, 1);
    this.lines++;
  }

  writeAll() {
    this.messages.forEach((message, index) => {
      this.writeLine(index);
    });
  }

  clear(filter = true) {
    if (!this.color || this.logLevel === 0) {
      return;
    }

    readline.cursorTo(process.stdout, 0);
    readline.moveCursor(process.stdout, 0, -this.lines);
    readline.clearScreenDown(process.stdout);
    this.lines = 0;
    if (filter) {
      this.messages = this.messages.filter(
        message => message.type === 'status' || message.persistent === true
      );
    }
    this.writeAll();
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

    this.clear(false);
  }

  persistent(message) {
    this.log(this.chalk.bold(message), true);
  }

  handleMessage(options) {
    let message = options.message;
    let persistent = options.persistent;
    let emoji = options.emoji;
    switch (options.messageType) {
      case 'log':
        this.log(message, persistent);
        break;
      case 'warning':
        this.warn(message, persistent);
        break;
      case 'error':
        this.error(message, persistent);
        break;
      case 'status':
        this.status(emoji, message, persistent);
        break;
      case 'persistent':
        this.persistent(message);
        break;
    }
  }
}

let loggerInstance;
function getLogger() {
  if (!loggerInstance) {
    loggerInstance = new Logger();
  }
  return loggerInstance;
}

module.exports = getLogger();

const chalk = require('chalk');
const readline = require('readline');
const prettyError = require('./utils/prettyError');
const getCursorPosition = require('get-cursor-position');

class Logger {
  constructor(options) {
    this.messages = [
      {
        type: 'status',
        persistent: true,
        content: '📦  Parcel bundler 🚀'
      }
    ];
    this.startLine = 0;
    if (process.stdout.isTTY) {
      this.startLine = getCursorPosition.sync().row;
    }
    this.updateOptions(options);
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

  getLastLine() {
    process.stderr.write('\u001b[?25h');
  }

  write(message, persistent = false, type = 'log') {
    message.split('\n').forEach(content => {
      if (content !== '') {
        let pos =
          this.messages.push({
            type: type,
            persistent: persistent,
            content: content
          }) - 1;
        this.writeLine(pos);
      }
    });
  }

  writeLine(line) {
    if (!this.messages[line]) return;
    let msg = this.messages[line].content;
    if (!this.color || !process.stdout.isTTY) {
      return this.log(msg);
    }

    let stdout = process.stdout;
    readline.cursorTo(stdout, 0, line + this.startLine);
    readline.clearLine(stdout, 0);
    stdout.write(msg);
    readline.cursorTo(stdout, 0, this.messages.length + this.startLine);
  }

  writeAll() {
    this.messages.forEach((message, index) => {
      this.writeLine(index);
    });
  }

  clear() {
    if (!this.color || this.logLevel === 0) {
      return;
    }

    readline.cursorTo(process.stdout, 0, this.startLine);
    readline.clearScreenDown(process.stdout);
    readline.cursorTo(process.stdout, 0, this.startLine);
    this.messages = this.messages.filter(
      message => message.type === 'status' || message.persistent === true
    );
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

    this.status('🚨', 'An error occured!', 'red');
    if (stack) {
      this.write(`🚨 ${this.chalk['red'].bold(message)}`, persistent, 'error');
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
}

module.exports = Logger;

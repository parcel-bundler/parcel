const chalk = require('chalk');
const readline = require('readline');
const prettyError = require('./utils/prettyError');

class Logger {
  constructor(options) {
    this.logLevel = typeof options.logLevel === 'number' ? options.logLevel : 3;
    this.color =
      typeof options.color === 'boolean' ? options.color : chalk.supportsColor;
    this.chalk = new chalk.constructor({enabled: this.color});
    this.lines = 0;
    this.statusLine = null;
  }

  write(message, persistent = false) {
    if (!persistent) {
      this.lines += message.split('\n').length;
    }

    console.log(message);
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

  warn(message) {
    if (this.logLevel < 2) {
      return;
    }

    this.write(this.chalk.yellow(message));
  }

  error(err) {
    if (this.logLevel < 1) {
      return;
    }

    let {message, stack} = prettyError(err, {color: this.color});

    this.status('🚨', message, 'red');
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
}

module.exports = Logger;

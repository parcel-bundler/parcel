// @flow strict-local

import {countBreaks} from 'grapheme-breaker';
import chalk, {type Chalk} from 'chalk';
import fs from 'fs';
import ora, {type Ora} from 'ora';
import path from 'path';
import readline from 'readline';
import stripAnsi from 'strip-ansi';
import WorkerFarm from '@parcel/workers';

import * as emoji from './emoji';
import prettyError, {
  type PrettyError,
  type PrettyErrorOpts,
  type PrintableError
} from './prettyError';

type LoggerOpts = {|
  color: boolean,
  emoji?: typeof emoji,
  isTest?: boolean,
  logLevel?: mixed
|};

class Logger {
  chalk: Chalk;
  color: boolean;
  emoji: typeof emoji;
  isTest: boolean;
  lines: number = 0;
  logLevel: number;
  logFile: ?stream$Writable;
  spinner: ?Ora = null;
  warnings: Set<PrintableError> = new Set();

  constructor(options: ?LoggerOpts) {
    this.setOptions(options);
  }

  setOptions(options: ?LoggerOpts) {
    this.logLevel =
      options && isNaN(options.logLevel) === false
        ? Number(options.logLevel)
        : 3;
    this.color =
      options && typeof options.color === 'boolean'
        ? options.color
        : Boolean(chalk.supportsColor);
    this.emoji = (options && options.emoji) || emoji;
    this.chalk = new chalk.constructor({enabled: this.color});
    this.isTest =
      options && typeof options.isTest === 'boolean'
        ? options.isTest
        : process.env.NODE_ENV === 'test';
  }

  countLines(message: string): number {
    return stripAnsi(message)
      .split('\n')
      .reduce((p, line) => {
        if (typeof process.stdout.columns === 'number') {
          return p + Math.ceil((line.length || 1) / process.stdout.columns);
        }

        return p + 1;
      }, 0);
  }

  writeRaw(message: string): void {
    this.stopSpinner();

    this.lines += this.countLines(message) - 1;
    process.stdout.write(message);
  }

  write(message: string, persistent: boolean = false) {
    if (this.logLevel > 3) {
      return this.verbose(message);
    }

    if (!persistent) {
      this.lines += this.countLines(message);
    }

    this.stopSpinner();
    this._log(message);
  }

  verbose(message: string): void {
    if (this.logLevel < 4) {
      return;
    }

    let currDate = new Date();
    let toLog = `[${currDate.toLocaleTimeString()}]: ${message}`;
    if (this.logLevel > 4) {
      if (!this.logFile) {
        this.logFile = fs.createWriteStream(
          path.join(process.cwd(), `parcel-debug-${currDate.toISOString()}.log`)
        );
      }
      this.logFile.write(stripAnsi(toLog) + '\n');
    }
    this._log(toLog);
  }

  log(message: string): void {
    if (this.logLevel < 3) {
      return;
    }

    this.write(message);
  }

  persistent(message: string): void {
    if (this.logLevel < 3) {
      return;
    }

    this.write(this.chalk.bold(message), true);
  }

  warn(err: PrintableError): void {
    if (this.logLevel < 2 || this.warnings.has(err)) {
      return;
    }

    this.warnings.add(err);
    this._writeError(err, this.emoji.warning, this.chalk.yellow);
  }

  error(err: PrintableError): void {
    if (this.logLevel < 1) {
      return;
    }

    this._writeError(err, this.emoji.error, this.chalk.red.bold);
  }

  success(message: string): void {
    this.log(`${this.emoji.success}  ${this.chalk.green.bold(message)}`);
  }

  formatError(err: PrintableError, opts: PrettyErrorOpts = {}): PrettyError {
    return prettyError(err, opts);
  }

  _writeError(
    err: PrintableError,
    emoji: string,
    color: (msg: string) => string
  ): void {
    let {message, stack} = this.formatError(err, {color: this.color});
    this.write(color(`${emoji}  ${message}`));
    if (stack != null) {
      this.write(stack);
    }
  }

  clear(): void {
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
    this.warnings.clear();
  }

  progress(message: string): void {
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

  stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  // $FlowFixMe
  handleMessage(options: {method: string, args: Array<any>}): void {
    // $FlowFixMe
    this[options.method](...options.args);
  }

  _log(message: string): void {
    // eslint-disable-next-line no-console
    console.log(message);
  }

  table(
    columns: Array<{|align: 'left' | 'right'|}>,
    table: Array<Array<string>>
  ): void {
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
function pad(
  text: string,
  length: number,
  align: 'left' | 'right' = 'left'
): string {
  let pad = ' '.repeat(length - stringWidth(text));
  if (align === 'right') {
    return pad + text;
  }

  return text + pad;
}

// Count visible characters in a string
function stringWidth(string: string): number {
  return countBreaks(stripAnsi('' + string));
}

let loggerExport: Logger;
// If we are in a worker, make a proxy class which will
// send the logger calls to the main process via IPC.
// These are handled in WorkerFarm and directed to handleMessage above.
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

  // $FlowFixMe Pretend as if this were a logger. We should probably export an interface instead.
  loggerExport = new LoggerProxy();
} else {
  loggerExport = new Logger();
}

export default loggerExport;

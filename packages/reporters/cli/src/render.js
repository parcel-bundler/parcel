// @flow
import type {Writable} from 'stream';

import * as process from 'process';
import {countBreaks} from 'grapheme-breaker';
import stripAnsi from 'strip-ansi';
import ora from 'ora';
import chalk from 'chalk';

type ColumnType = {|
  align: 'left' | 'right',
|};

// For test purposes
let stdout = process.stdout;
let stderr = process.stderr;

let spinners = new Map();

// Exported only for test
export function _setStdio(stdoutLike: Writable, stderrLike: Writable) {
  stdout = stdoutLike;
  stderr = stderrLike;
}

export function writeOut(message: string, isError?: boolean) {
  if (isError) {
    stderr.write(message + '\n');
  } else {
    stdout.write(message + '\n');
  }
}

export function updateSpinner(name: string, message: string) {
  let isEnabled = process.env.NODE_ENV !== 'test' && !!process.stdout.isTTY;

  let s = spinners.get(name);
  if (!s) {
    s = ora({
      text: message,
      color: 'green',
      stream: stdout,
      isEnabled,
    }).start();
    spinners.set(name, s);
  } else {
    s.text = message;
  }
}

export function clearSpinner(name: string) {
  let s = spinners.get(name);
  if (s) {
    s.stop();
  }
}

export function persistSpinner(
  name: string,
  status: 'success' | 'error' | 'warn' | 'info',
  message?: string,
) {
  let s = spinners.get(name);
  if (s) {
    switch (status) {
      case 'success':
        s.succeed(chalk.green.bold(message));
        break;
      case 'error':
        s.fail(chalk.red.bold(message));
        break;
      case 'warn':
        s.warn(chalk.orange.bold(message));
        break;
      case 'info':
        s.info(chalk.blue.bold(message));
        break;
    }
  }
}

// Count visible characters in a string
function stringWidth(string) {
  return countBreaks(stripAnsi('' + string));
}

// Pad a string with spaces on either side
function pad(text, length, align = 'left') {
  let pad = ' '.repeat(length - stringWidth(text));
  if (align === 'right') {
    return pad + text;
  }

  return text + pad;
}

export function table(columns: Array<ColumnType>, table: Array<Array<string>>) {
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

    writeOut(items.join(''));
  }
}

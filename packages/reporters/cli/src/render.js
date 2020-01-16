// @flow
import type {Writable} from 'stream';

import ora from 'ora';
import stringWidth from 'string-width';

import type {PadAlign} from './utils';
import {pad, countLines} from './utils';
import * as emoji from './emoji';

type ColumnType = {|
  align: PadAlign,
|};

// $FlowFixMe
export const isTTY = process.env.NODE_ENV !== 'test' && process.stdout.isTTY;

let stdout = process.stdout;
let lineCount = 0;

export function _setStdio(stdoutLike: Writable) {
  stdout = stdoutLike;
}

let spinner = ora({
  color: 'green',
  stream: stdout,
  isEnabled: isTTY,
});
let persistedMessages = [];

export function writeOut(message: string) {
  let processedMessage = message + '\n';
  let hasSpinner = spinner.isSpinning;

  if (hasSpinner) {
    spinner.stop();
  }

  stdout.write(processedMessage);
  lineCount += countLines(message);

  if (hasSpinner) {
    spinner.start();
  }
}

export function persistMessage(message: string) {
  if (persistedMessages.includes(message)) return;

  persistedMessages.push(message);
  writeOut(message);
}

export function updateSpinner(message: string) {
  spinner.text = message + '\n';
  if (!spinner.isSpinning) {
    spinner.start();
  }
}

// $FlowFixMe
function clearStream(s: any, l: number) {
  s.moveCursor(0, -l);
  s.clearScreenDown();
}

// Reset the window's state
export function resetWindow() {
  if (!isTTY) return;

  clearStream(stdout, lineCount);
  lineCount = 0;

  for (let m of persistedMessages) {
    writeOut(m);
  }
}

export function persistSpinner(
  name: string,
  status: 'success' | 'error',
  message: string,
) {
  spinner.stopAndPersist({
    symbol: emoji[status],
    text: message,
  });
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

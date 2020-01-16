// @flow strict-local
import type {Writable} from 'stream';

import ora from 'ora';

import type {PadAlign} from './utils';
import {stringWidth, pad, countLines} from './utils';
import * as emoji from './emoji';

type ColumnType = {|
  align: PadAlign,
|};

// $FlowFixMe
export const isTTY = process.env.NODE_ENV !== 'test' && process.stdout.isTTY;

let stdout = process.stdout;
let stderr = process.stderr;

export function _setStdio(stdoutLike: Writable, stderrLike: Writable) {
  stdout = stdoutLike;
  stderr = stderrLike;
}

let spinners = new Map();
let persistedMessages = [];
let stdoutLines = 0;
let stderrLines = 0;

export function writeOut(message: string, isError?: boolean) {
  let processedMessage = message + '\n';
  let lineCount = countLines(processedMessage);

  if (isError) {
    stderr.write(processedMessage);
    stderrLines += lineCount;
  } else {
    stdout.write(processedMessage);
    stdoutLines += lineCount;
  }
}

export function persistMessage(message: string) {
  if (persistedMessages.includes(message)) return;

  persistedMessages.push(message);
  resetWindow();
}

export function updateSpinner(name: string, message: string) {
  let s = spinners.get(name);
  if (!s) {
    s = ora({
      text: message,
      color: 'green',
      stream: stdout,
      isEnabled: isTTY,
    }).start();
    spinners.set(name, s);
  } else {
    s.text = message;
  }
}

export function tickSpinners() {
  for (let v of spinners.values()) {
    v.frame();
  }
}

function renderPersistedMessages() {
  for (let m of persistedMessages) {
    writeOut(m);
  }
}

// $FlowFixMe
function clearLines(s: any, lines: number) {
  for (let i = 0; i < lines; i++) {
    if (i > 0) {
      s.moveCursor(0, -1);
    }

    s.clearLine();
    s.cursorTo(0);
  }
}

// Reset the window's state
export function resetWindow() {
  if (!isTTY) return;

  clearLines(stderr, stderrLines);
  stderrLines = 0;

  clearLines(stdout, stdoutLines);
  stdoutLines = 0;

  renderPersistedMessages();
  tickSpinners();
}

export function persistSpinner(
  name: string,
  status: 'success' | 'error',
  message?: string,
) {
  let s = spinners.get(name);
  if (s) {
    s.stopAndPersist({
      symbol: emoji[status],
      // $FlowFixMe
      text: message || s.text || '',
    });
  }
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

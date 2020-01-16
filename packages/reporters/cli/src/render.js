// @flow
import type {Writable} from 'stream';

import * as process from 'process';
import {countBreaks} from 'grapheme-breaker';
import stripAnsi from 'strip-ansi';

type ColumnType = {|
  align: 'left' | 'right',
|};

// For test purposes
let stdout = process.stdout;
let stderr = process.stderr;

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

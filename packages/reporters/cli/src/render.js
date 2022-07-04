// @flow
import type {Writable} from 'stream';

import readline from 'readline';
import ora from 'ora';
import stringWidth from 'string-width';
import termSize from 'term-size';
import sliceAnsi from 'slice-ansi';

import type {PadAlign} from './utils';
import {pad, countLines} from './utils';
import * as emoji from './emoji';

type ColumnType = {|
  align: PadAlign,
|};

export const isTTY: any | boolean | true =
  // $FlowFixMe
  process.env.NODE_ENV !== 'test' && process.stdout.isTTY;

let stdout = process.stdout;
let stderr = process.stderr;

stdout.setMaxListeners(100);
stderr.setMaxListeners(100);

// Some state so we clear the output properly
let statusPersisted = false;
export let terminalSize: $Call<typeof termSize> = termSize();
let pageHeight = terminalSize.rows;

export function _setStdio(stdoutLike: Writable, stderrLike: Writable) {
  stdout = stdoutLike;
  stderr = stderrLike;
}

let spinner = ora({
  color: 'green',
  stream: stdout,
  discardStdin: false,
});

let header = [];
let footer = [];
let scrollingLines = [];
let scrollOffset = 0;
let isInteractive = false;

export function init() {
  isInteractive = isTTY;
  if (!isInteractive) {
    return;
  }

  stdout.write('\x1b[?1049h'); // use alternate buffer
  stdout.write('\x1b[?1h'); // enable application cursor keys
  stdout.write('\x1b='); // enable application keypad
  stdout.write('\x1b[?25l'); // hide cursor

  stdout.on('resize', () => {
    terminalSize = termSize();
    pageHeight = getPageHeight();

    readline.cursorTo(stdout, 0, 0);
    readline.clearScreenDown(stdout);

    let y = 0;
    for (let line of header) {
      readline.cursorTo(stdout, 0, y++);
      stdout.write(line);
    }

    for (
      let i = 0, h = Math.min(pageHeight, scrollingLines.length);
      i < h;
      i++
    ) {
      readline.cursorTo(stdout, 0, y++);
      stdout.write(scrollingLines[scrollOffset + i]);
    }

    for (let line of footer) {
      readline.cursorTo(stdout, 0, y++);
      stdout.write(sliceAnsi(line, 0, terminalSize.columns - 2));
    }
  });
}

export function exit() {
  if (isInteractive) {
    stdout.write('\x1b>'); // disable application keypad
    stdout.write('\x1b[?1l'); // disable application cursor keys
    stdout.write('\x1b[?1049l'); // disable alternate buffer
    stdout.write('\x1b[?25h'); // show cursor
  }
}

export function writeOut(message: string, isError: boolean = false) {
  let hasSpinner = spinner.isSpinning;

  // Stop spinner so we don't duplicate it
  if (hasSpinner) {
    spinner.stop();
  }

  if (isInteractive) {
    let writtenLines = scrollingLines.length;
    let processedLines = message.split('\n');
    scrollingLines.push(...processedLines);

    let linesToWrite = Math.min(
      processedLines.length,
      terminalSize.rows - writtenLines - 1,
    );
    let w = header.length + writtenLines;
    for (let i = 0; i < linesToWrite; i++) {
      readline.cursorTo(stdout, 0, w++);
      stdout.write(processedLines[i]);
    }
  } else {
    let processedMessage = message + '\n';
    if (isError) {
      stderr.write(processedMessage);
    } else {
      stdout.write(processedMessage);
    }
  }

  // Restart the spinner
  if (hasSpinner) {
    spinner.start();
  }
}

export function updateLine(x: number, y: number, string: string) {
  if (isInteractive) {
    while (scrollingLines.length <= y) {
      scrollingLines.push('');
    }

    scrollingLines[y] = scrollingLines[y].slice(0, x).padEnd(x, ' ') + string;
  }

  if (
    !isInteractive ||
    (y >= scrollOffset && y <= scrollOffset + getPageHeight())
  ) {
    cursorTo(x, y);
    stdout.write(string);
    readline.clearLine(stdout, 1);
  }
}

export function moveBy(lines: number) {
  scrollTo(scrollOffset + lines);
}

export function getPageHeight(): number {
  return terminalSize.rows - header.length - footer.length;
}

export function scrollTo(line: number) {
  let headerLines = header.length;
  let height = getPageHeight();
  let lastScrollOffset = scrollOffset;
  scrollOffset = Math.max(0, Math.min(scrollingLines.length - height, line));
  if (lastScrollOffset === scrollOffset) {
    return;
  }

  let dy = scrollOffset - lastScrollOffset;
  if (Math.abs(dy) >= height) {
    dy = -height;
  }

  stdout.write(`\x1b[${headerLines + 1};${headerLines + height}r`); // set scrolling region
  stdout.write(`\x1b[${Math.abs(dy)}${dy > 0 ? 'S' : 'T'}`);

  let base = dy > 0 ? headerLines + height - dy : headerLines;
  let baseIndex = dy > 0 ? scrollOffset + height - dy : scrollOffset;
  for (let i = 0; i < Math.abs(dy); i++) {
    readline.cursorTo(stdout, 0, base + i);
    stdout.write(scrollingLines[baseIndex + i]);
  }
}

export function scrollIfNeeded(y: number) {
  if (y < scrollOffset || y > scrollOffset + getPageHeight()) {
    scrollTo(y);
  }
}

export function cursorTo(x: number, y: number) {
  scrollIfNeeded(y);
  readline.cursorTo(stdout, x, header.length + y - scrollOffset);
}

export function persistMessage(message: string) {
  if (header.includes(message)) return;

  header.push(message);

  if (isInteractive) {
    if (scrollingLines.length || footer.length) {
      updatePageHeight();
    } else {
      readline.cursorTo(stdout, 0, header.length - 1);
      stdout.write(message);
    }
  } else {
    writeOut(message);
  }
}

export function addFooterLine(message: string) {
  footer.push(message);
  updatePageHeight();

  readline.cursorTo(stdout, 0, header.length + pageHeight + footer.length - 1);
  stdout.write(message);
}

export function updateFooterLine(x: number, y: number, message: string) {
  let didUpdateHeight = false;
  while (footer.length <= y) {
    footer.push('');
    didUpdateHeight = true;
  }

  footer[y] = footer[y].slice(0, x).padEnd(x, ' ') + message;

  if (didUpdateHeight) {
    updatePageHeight();
  }

  readline.cursorTo(stdout, x, header.length + pageHeight + y);
  stdout.write(message);
  readline.clearLine(stdout, 1);
}

function updatePageHeight() {
  let newHeight = getPageHeight();
  if (newHeight < pageHeight) {
    let y = header.length + newHeight;
    readline.cursorTo(stdout, 0, y);
    readline.clearScreenDown(stdout);
    for (let line of footer) {
      readline.cursorTo(stdout, 0, y);
      stdout.write(line);
      y++;
    }
  } else if (newHeight > pageHeight) {
    let h = header.length;
    let y = pageHeight;
    readline.cursorTo(stdout, 0, h + y);
    readline.clearScreenDown(stdout);
    while (y <= newHeight) {
      readline.cursorTo(stdout, 0, h + y);
      stdout.write(scrollingLines[y]);
      y++;
    }
    for (let line of footer) {
      readline.cursorTo(stdout, 0, h + y);
      stdout.write(line);
      y++;
    }
  }

  pageHeight = newHeight;
}

export function updateSpinner(message: string) {
  // This helps the spinner play well with the tests
  if (!isInteractive) {
    writeOut(message);
    return;
  }

  spinner.text = message + '\n';
  if (!spinner.isSpinning) {
    spinner.start();
  }
}

export function persistSpinner(
  name: string,
  status: 'success' | 'error',
  message: string,
) {
  spinner.stop();
  persistMessage(`${emoji[status]} ${message}`);
  statusPersisted = true;

  if (isInteractive) {
    // ora shows cursor on stop, so hide it again if interactive.
    stdout.write('\x1b[?25l');
  }
}

function clearStream(stream: Writable, lines: number) {
  if (!isInteractive) return;

  readline.moveCursor(stream, 0, -lines);
  readline.clearScreenDown(stream);
}

// Reset the window's state
export function resetWindow() {
  if (!isInteractive) return;

  // If status has been persisted, remove it from the header.
  if (statusPersisted) {
    header.pop();
    statusPersisted = false;
  }

  readline.cursorTo(stdout, 0, header.length);
  readline.clearScreenDown(stdout);

  scrollingLines.length = 0;
  footer.length = 0;
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

export function getLocation(): number {
  return scrollingLines.length;
}

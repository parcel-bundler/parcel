// @flow strict-local
import type {BuildProgressEvent} from '@parcel/types';

import path from 'path';
import {countBreaks} from 'grapheme-breaker';
import stripAnsi from 'strip-ansi';
// $FlowFixMe
import chalk from 'chalk';

export type PadAlign = 'left' | 'right';

export function getProgressMessage(event: BuildProgressEvent): ?string {
  switch (event.phase) {
    case 'transforming':
      return `Building ${path.basename(event.filePath)}...`;

    case 'bundling':
      return 'Bundling...';

    case 'packaging':
      return `Packaging ${path.basename(event.bundle.filePath || '')}...`;

    case 'optimizing':
      return `Optimizing ${path.basename(event.bundle.filePath || '')}...`;
  }

  return null;
}

// Count visible characters in a string
export function stringWidth(s: string) {
  return countBreaks(stripAnsi('' + s));
}

// Pad a string with spaces on either side
export function pad(text: string, length: number, align: PadAlign = 'left') {
  let pad = ' '.repeat(length - stringWidth(text));
  if (align === 'right') {
    return pad + text;
  }

  return text + pad;
}

export function formatFilename(
  filename: string,
  color: (s: string) => string = chalk.reset,
) {
  let dir = path.relative(process.cwd(), path.dirname(filename));
  return (
    chalk.dim(dir + (dir ? path.sep : '')) + color(path.basename(filename))
  );
}

export function countLines(message: string) {
  return stripAnsi(message)
    .split('\n')
    .reduce((p, line) => {
      // $FlowFixMe Sketchy null checks are FUN
      if (process.stdout.columns) {
        return p + Math.ceil((line.length || 1) / process.stdout.columns);
      }

      return p + 1;
    }, 0);
}

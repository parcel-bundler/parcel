// @flow
import type {BuildProgressEvent} from '@parcel/types';

import path from 'path';
import chalk from 'chalk';
import stringWidth from 'string-width';
import termSize from 'term-size';
import stripAnsi from 'strip-ansi';

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
  let {columns} = termSize();

  return stripAnsi(message)
    .split('\n')
    .reduce((p, line) => p + Math.ceil((stringWidth(line) || 1) / columns), 0);
}

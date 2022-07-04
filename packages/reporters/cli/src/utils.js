// @flow
import type {BuildProgressEvent} from '@parcel/types';

import path from 'path';
import chalk from 'chalk';
import stringWidth from 'string-width';
import termSize from 'term-size';
import stripAnsi from 'strip-ansi';
import wrapAnsi from 'wrap-ansi';
import {terminalSize} from './render';

export type PadAlign = 'left' | 'right';

export function getProgressMessage(event: BuildProgressEvent): ?string {
  switch (event.phase) {
    case 'transforming':
      return `Building ${path.basename(event.filePath)}...`;

    case 'bundling':
      return 'Bundling...';

    case 'packaging':
      return `Packaging ${event.bundle.displayName}...`;

    case 'optimizing':
      return `Optimizing ${event.bundle.displayName}...`;
  }

  return null;
}

// Pad a string with spaces on either side
export function pad(
  text: string,
  length: number,
  align: PadAlign = 'left',
): string {
  let pad = ' '.repeat(length - stringWidth(text));
  if (align === 'right') {
    return pad + text;
  }

  return text + pad;
}

export function formatFilename(
  filename: string,
  color: (s: string) => string = chalk.reset,
): string {
  let dir = path.relative(process.cwd(), path.dirname(filename));
  return (
    chalk.dim(dir + (dir ? path.sep : '')) + color(path.basename(filename))
  );
}

export function countLines(message: string): number {
  let {columns} = terminalSize;

  return stripAnsi(message)
    .split('\n')
    .reduce((p, line) => p + Math.ceil((stringWidth(line) || 1) / columns), 0);
}

export function wrapWithIndent(
  string: string,
  indent: number = 0,
  initialIndent: number = indent,
): string {
  let width = terminalSize.columns;
  return indentString(
    wrapAnsi(string.trimEnd(), width - indent, {trim: false}),
    indent,
    initialIndent,
  );
}

export function indentString(
  string: string,
  indent: number = 0,
  initialIndent: number = indent,
): string {
  return (
    ' '.repeat(initialIndent) + string.replace(/\n/g, '\n' + ' '.repeat(indent))
  );
}

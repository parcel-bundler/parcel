// @flow strict-local

import type {FilePath} from '@parcel/types';
import path from 'path';

const SEPARATOR_REGEX = /[/\\]+/;

export function normalizeSeparators(
  filePath: FilePath,
  replaceValue: string = path.sep,
): FilePath {
  return filePath.split(SEPARATOR_REGEX).join(replaceValue);
}

export function relatifyPath(from: string, to: string) {
  let filename = path.relative(from, to);
  if (filename[0] !== '.') {
    filename = './' + filename;
  }
  return filename.replace(/\\+/g, '/');
}

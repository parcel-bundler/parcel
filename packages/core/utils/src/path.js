// @flow strict-local
import type {FilePath} from '@parcel/types';
import path from 'path';

const SEPARATOR_REGEX = /[\\]+/g;

export function normalizeSeparators(filePath: FilePath): FilePath {
  return filePath.replace(SEPARATOR_REGEX, '/');
}

export type PathOptions = {
  noLeadingDotSlash?: boolean,
  ...
};

export function normalizePath(
  filePath: FilePath,
  leadingDotSlash: boolean = true,
): FilePath {
  if (leadingDotSlash && filePath[0] !== '.' && filePath[0] !== '/') {
    return normalizeSeparators('./' + filePath);
  } else {
    return normalizeSeparators(filePath);
  }
}

export function relativePath(
  from: string,
  to: string,
  leadingDotSlash: boolean = true,
) {
  return normalizePath(path.relative(from, to), leadingDotSlash);
}

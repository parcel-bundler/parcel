// @flow strict-local

import type {FilePath} from '@parcel/types';
import path from 'path';

const COMMON_SEPARATORS = ['/', '\\'];

export function normalizeSeparators(filePath: FilePath): FilePath {
  let ret = filePath;

  for (let separator of COMMON_SEPARATORS) {
    ret = ret.split(separator).join(path.sep);
  }

  return ret;
}

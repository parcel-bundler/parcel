// @flow strict-local
import type {FilePath} from '@parcel/types';
import path from 'path';

export default function isDirectoryInside(child: FilePath, parent: FilePath) {
  const relative = path.relative(parent, child);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

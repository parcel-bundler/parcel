// @flow strict-local

import path from 'path';

export default function urlRelative(from: string, to: string): string {
  return path.posix.relative(path.dirname(from), to);
}

// @flow strict-local

import type {FileSystem} from '@parcel/rust';
import type {
  Encoding,
  FilePath,
  FileSystem as ClassicFileSystem,
} from '@parcel/types-internal';

import {jsCallable} from './jsCallable';

// Move to @parcel/utils or a dedicated v3 / migration package later
export function toFileSystemV3(fs: ClassicFileSystem): FileSystem {
  return {
    canonicalize: jsCallable((path: FilePath) => fs.realpathSync(path)),
    createDirectory: jsCallable((path: FilePath) => fs.mkdirp(path)),
    cwd: jsCallable(() => fs.cwd()),
    readFile: jsCallable((path: string, encoding?: Encoding) =>
      fs.readFileSync(path, encoding ?? 'utf8'),
    ),
    isFile: (path: string) => {
      try {
        return fs.statSync(path).isFile();
      } catch {
        return false;
      }
    },
    isDir: (path: string) => {
      try {
        return fs.statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

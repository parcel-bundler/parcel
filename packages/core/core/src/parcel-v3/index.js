// @flow

import type {FileSystem} from '@parcel/rust';
import type {
  Encoding,
  FilePath,
  FileSystem as ClassicFileSystem,
} from '@parcel/types-internal';

export {ParcelV3} from './ParcelV3';
export type * from './ParcelV3';

export function toFileSystemV3(fs: ClassicFileSystem): FileSystem {
  return {
    canonicalize: (path: FilePath) => fs.realpathSync(path),
    cwd: () => fs.cwd(),
    readFile: (path: string, encoding?: Encoding) =>
      fs.readFileSync(path, encoding ?? 'utf8'),
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

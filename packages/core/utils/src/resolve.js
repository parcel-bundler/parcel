// @flow strict-local

import type {PackageJSON} from '@parcel/types';
import type {ResolveOptions} from 'resolve';
import type {FileSystem} from '@parcel/fs';

// $FlowFixMe TODO: Type promisify
import promisify from './promisify';

const _resolve = promisify(require('resolve'));

export default function resolve(
  fs: FileSystem,
  id: string,
  opts?: ResolveOptions
): Promise<[string, ?PackageJSON]> {
  return _resolve(id, {
    ...opts,
    async readFile(filename, callback) {
      try {
        let res = await fs.readFile(filename);
        callback(null, res);
      } catch (err) {
        callback(err);
      }
    },
    async isFile(file, callback) {
      try {
        let stat = await fs.stat(file);
        callback(null, stat.isFile());
      } catch (err) {
        callback(null, false);
      }
    },
    async isDirectory(file, callback) {
      try {
        let stat = await fs.stat(file);
        callback(null, stat.isDirectory());
      } catch (err) {
        callback(null, false);
      }
    }
  });
}

// @flow strict-local

import type {PackageJSON, FilePath, ModuleSpecifier} from '@parcel/types';
import type {ResolveOptions} from 'resolve';
import type {FileSystem} from '@parcel/fs';

// $FlowFixMe TODO: Type promisify
import promisify from './promisify';
import _resolve from 'resolve';

const resolveAsync = promisify(_resolve);

export type ResolveResult = {|
  resolved: FilePath | ModuleSpecifier,
  pkg?: ?PackageJSON
|};

export async function resolve(
  fs: FileSystem,
  id: string,
  opts?: ResolveOptions
): Promise<ResolveResult> {
  if (process.env.PARCEL_BUILD_ENV !== 'production') {
    // $FlowFixMe
    opts = opts || {};
    // $FlowFixMe
    opts.packageFilter = pkg => {
      if (pkg.name.startsWith('@parcel/') && pkg.name !== '@parcel/watcher') {
        if (pkg.source) {
          pkg.main = pkg.source;
        }
      }
      return pkg;
    };
  }

  let res = await resolveAsync(id, {
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

  if (typeof res === 'string') {
    return {
      resolved: res
    };
  }

  return {
    resolved: res[0],
    pkg: res[1]
  };
}

export function resolveSync(
  fs: FileSystem,
  id: string,
  opts?: ResolveOptions
): ResolveResult {
  if (process.env.PARCEL_BUILD_ENV !== 'production') {
    // $FlowFixMe
    opts = opts || {};
    // $FlowFixMe
    opts.packageFilter = pkg => {
      if (pkg.name.startsWith('@parcel/') && pkg.name !== '@parcel/watcher') {
        if (pkg.source) {
          pkg.main = pkg.source;
        }
      }
      return pkg;
    };
  }

  // $FlowFixMe
  let res = _resolve.sync(id, {
    ...opts,
    readFileSync: (...args) => {
      return fs.readFileSync(...args);
    },
    isFile: file => {
      try {
        let stat = fs.statSync(file);
        return stat.isFile();
      } catch (err) {
        return false;
      }
    },
    isDirectory: file => {
      try {
        let stat = fs.statSync(file);
        return stat.isDirectory();
      } catch (err) {
        return false;
      }
    }
  });

  return {
    resolved: res
  };
}

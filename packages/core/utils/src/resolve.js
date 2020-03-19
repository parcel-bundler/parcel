// @flow strict-local

import type {
  SemverRange,
  PackageJSON,
  FilePath,
  ModuleSpecifier,
} from '@parcel/types';
import type {ResolveOptions} from 'resolve';
import type {FileSystem} from '@parcel/fs';

// $FlowFixMe TODO: Type promisify
import promisify from './promisify';
import _resolve from 'resolve';
import {resolveConfig, resolveConfigSync} from '../';
// $FlowFixMe this is untyped
import Module from 'module';

const resolveAsync = promisify(_resolve);

export type ResolveResult = {|
  resolved: FilePath | ModuleSpecifier,
  pkg?: ?PackageJSON,
|};

export async function resolve(
  fs: FileSystem,
  id: string,
  opts: {|
    range?: ?SemverRange,
    ...ResolveOptions,
    basedir: string,
  |},
): Promise<ResolveResult> {
  if (process.env.PARCEL_BUILD_ENV !== 'production') {
    // Yarn patches resolve automatically in a non-linked setup
    let pnp;
    if (
      process.versions.pnp != null &&
      (!id.includes('@parcel/') || id.startsWith('@parcel/watcher')) &&
      (pnp = Module.findPnpApi(opts.basedir))
    ) {
      try {
        let res = pnp.resolveRequest(id, `${opts.basedir}/`, {
          extensions: opts.extensions,
          considerBuiltins: true,
        });

        if (!res) {
          // builtin
          return {resolved: id};
        }

        let pkgFile = await resolveConfig(fs, res, ['package.json']);
        let pkg = null;
        if (pkgFile != null) {
          pkg = JSON.parse(await fs.readFile(pkgFile, 'utf8'));
        }

        if (res) {
          return {resolved: res, pkg};
        }
      } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
          throw e;
        }
      }
    }

    // $FlowFixMe
    opts.packageFilter = pkg => {
      if (
        typeof pkg.name === 'string' &&
        pkg.name.startsWith('@parcel/') &&
        pkg.name !== '@parcel/watcher'
      ) {
        if (pkg.source) {
          pkg.main = pkg.source;
        }
      }
      return pkg;
    };
  }

  if (id === 'pnpapi') {
    // the resolve package doesn't recognize pnpapi as a builtin
    return {resolved: 'pnpapi'};
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
    },
  });

  if (typeof res === 'string') {
    return {
      resolved: res,
    };
  }

  return {
    resolved: res[0],
    pkg: res[1],
  };
}

export function resolveSync(
  fs: FileSystem,
  id: string,
  opts: {|
    ...ResolveOptions,
    basedir: string,
  |},
): ResolveResult {
  if (process.env.PARCEL_BUILD_ENV !== 'production') {
    // Yarn patches resolve automatically in a non-linked setup
    let pnp;
    if (
      process.versions.pnp != null &&
      (!id.startsWith('@parcel') || id.startsWith('@parcel/watcher')) &&
      (pnp = Module.findPnpApi(opts.basedir))
    ) {
      try {
        let res = pnp.resolveRequest(id, `${opts.basedir}/`, {
          extensions: opts.extensions,
          considerBuiltins: true,
        });

        if (!res) {
          // builtin
          return {resolved: id};
        }

        let pkgFile = resolveConfigSync(fs, res, ['package.json']);
        let pkg = null;
        if (pkgFile != null) {
          pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
        }

        if (res) {
          return {resolved: res, pkg};
        }
      } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
          throw e;
        }
      }
    }

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

  if (id === 'pnpapi') {
    // the resolve package doesn't recognize pnpapi as a builtin
    return {resolved: 'pnpapi'};
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
    },
  });

  return {
    resolved: res,
  };
}

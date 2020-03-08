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
import path from 'path';

const resolveAsync = promisify(_resolve);

async function findPackage(fs: FileSystem, from: string) {
  // Find the nearest package.json file within the current node_modules folder
  let root = path.parse(from).root;
  let dir = from;
  while (dir !== root && path.basename(dir) !== 'node_modules') {
    let file = path.join(dir, 'package.json');
    if (await fs.exists(file)) {
      return file;
    }

    dir = path.dirname(dir);
  }

  return null;
}

function findPackageSync(fs: FileSystem, from: string) {
  // Find the nearest package.json file within the current node_modules folder
  let root = path.parse(from).root;
  let dir = from;
  while (dir !== root && path.basename(dir) !== 'node_modules') {
    let file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      return file;
    }

    dir = path.dirname(dir);
  }

  return null;
}

export type ResolveResult = {|
  resolved: FilePath | ModuleSpecifier,
  pkg?: ?PackageJSON,
|};

export async function resolve(
  fs: FileSystem,
  id: string,
  opts?: {|
    range?: ?SemverRange,
    ...ResolveOptions,
  |},
): Promise<ResolveResult> {
  if (process.env.PARCEL_BUILD_ENV !== 'production') {
    // Yarn patches resolve automatically in a non-linked setup
    if (
      process.versions.pnp != null &&
      (!id.includes('@parcel/') || id.startsWith('@parcel/watcher'))
    ) {
      try {
        let basedir = opts?.basedir;
        // $FlowFixMe - injected" at runtime
        let res = require('pnpapi').resolveRequest(
          id,
          basedir != null ? `${basedir}/` : null,
          {
            extensions: opts?.extensions,
            considerBuiltins: true,
          },
        );

        if (!res) {
          // builtin
          return {resolved: id};
        }

        let pkgFile = await findPackage(fs, path.dirname(res));
        let pkg = null;
        if (pkgFile != null) {
          pkg = JSON.parse(await fs.readFile(pkgFile, 'utf8'));
        }

        if (res) {
          return {resolved: res, pkg};
        }
      } catch (_) {
        global.abccc = _;
        // NOOP
      }
    }

    // $FlowFixMe
    opts = opts || {};
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
    return {resolved: require.resolve('pnpapi')};
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
  opts?: ResolveOptions,
): ResolveResult {
  if (process.env.PARCEL_BUILD_ENV !== 'production') {
    // Yarn patches resolve automatically in a non-linked setup
    if (
      process.versions.pnp != null &&
      (!id.startsWith('@parcel') || id.startsWith('@parcel/watcher'))
    ) {
      try {
        let basedir = opts?.basedir;
        // $FlowFixMe - injected" at runtime
        let res = require('pnpapi').resolveRequest(
          id,
          basedir != null ? `${basedir}/` : null,
          {
            extensions: opts?.extensions,
            considerBuiltins: true,
          },
        );

        if (!res) {
          // builtin
          return {resolved: id};
        }

        let pkgFile = findPackageSync(fs, path.dirname(res));
        let pkg = null;
        if (pkgFile != null) {
          pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
        }

        if (res) {
          return {resolved: res, pkg};
        }
      } catch (_) {
        // NOOP
      }
    }

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

  if (id === 'pnpapi') {
    // the resolve package doesn't recognize pnpapi as a builtin
    return {resolved: require.resolve('pnpapi')};
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

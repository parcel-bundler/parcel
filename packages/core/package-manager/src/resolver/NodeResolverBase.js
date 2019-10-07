// @flow

import type {PackageJSON, FilePath, ModuleSpecifier} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import Module from 'module';
import path from 'path';

const builtins = {};
for (let builtin of Module.builtinModules) {
  builtins[builtin] = true;
}

export type InternalPackageJSON = PackageJSON & {pkgdir: string, ...};
export type ResolveResult = {|
  resolved: FilePath | ModuleSpecifier,
  pkg?: ?PackageJSON
|};

export class NodeResolverBase<T> {
  fs: FileSystem;
  extensions: Array<string>;
  cache: Map<string, T | Error>;
  packageCache: Map<string, InternalPackageJSON>;

  constructor(fs: FileSystem, extensions?: Array<string>) {
    this.fs = fs;
    this.extensions = extensions || Object.keys(Module._extensions);
    this.cache = new Map();
    this.packageCache = new Map();
  }

  resolve(id: ModuleSpecifier, from: FilePath): T {
    let key = `${id}:${from}`;
    let res = this.cache.get(key);
    if (res != null) {
      if (res instanceof Error) {
        throw res;
      }

      return res;
    }

    try {
      res = this.resolveUncached(id, from);
      this.cache.set(key, res);
      return res;
    } catch (err) {
      this.cache.set(key, err);
      throw err;
    }
  }

  resolveUncached(id: ModuleSpecifier, from: FilePath): T {
    throw new Error(`Could not resolve "${id}" from "${from}"`);
  }

  expandFile(file: FilePath) {
    // Expand extensions and aliases
    let res = [];
    for (let ext of this.extensions) {
      let f = file + ext;
      res.push(f);
    }

    if (path.extname(file)) {
      res.unshift(file);
    } else {
      res.push(file);
    }

    return res;
  }

  getPackageEntries(pkg: InternalPackageJSON) {
    return [pkg.main]
      .filter(entry => typeof entry === 'string')
      .map(main => {
        // Default to index file if no main field find
        if (!main || main === '.' || main === './') {
          main = 'index';
        }

        if (typeof main !== 'string') {
          throw new Error('invariant: expected string');
        }

        return path.resolve(pkg.pkgdir, main);
      });
  }

  getModuleParts(name: ModuleSpecifier) {
    let parts = path.normalize(name).split(path.sep);
    if (parts[0].charAt(0) === '@') {
      // Scoped module (e.g. @scope/module). Merge the first two parts back together.
      parts.splice(0, 2, `${parts[0]}/${parts[1]}`);
    }

    return parts;
  }

  isBuiltin(name: ModuleSpecifier) {
    return !!builtins[name];
  }
}

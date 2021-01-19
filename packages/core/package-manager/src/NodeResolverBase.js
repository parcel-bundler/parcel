// @flow

import type {PackageJSON, FilePath, ModuleSpecifier} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
// $FlowFixMe
import Module from 'module';
import path from 'path';
import invariant from 'assert';

const builtins = {pnpapi: true};
for (let builtin of Module.builtinModules) {
  builtins[builtin] = true;
}

export type ResolveResult = {|
  resolved: FilePath | ModuleSpecifier,
  pkg?: ?PackageJSON,
|};

export type ModuleInfo = {|
  moduleName: string,
  subPath: ?string,
  moduleDir: FilePath,
  filePath: FilePath,
  code?: string,
|};

export class NodeResolverBase<T> {
  fs: FileSystem;
  extensions: Array<string>;
  packageCache: Map<string, PackageJSON>;

  constructor(fs: FileSystem, extensions?: Array<string>) {
    this.fs = fs;
    this.extensions = extensions || Object.keys(Module._extensions);
    this.packageCache = new Map();
  }

  resolve(id: ModuleSpecifier, from: FilePath): T {
    throw new Error(`Could not resolve "${id}" from "${from}"`);
  }

  expandFile(file: FilePath): Array<FilePath> {
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

  getPackageEntries(dir: FilePath, pkg: PackageJSON): Array<string> {
    let main = pkg.main;
    if (
      process.env.PARCEL_BUILD_ENV !== 'production' &&
      typeof pkg.name === 'string' &&
      pkg.name.startsWith('@parcel/') &&
      pkg.name !== '@parcel/watcher'
    ) {
      main = pkg.source;
    }

    return [main]
      .filter(entry => typeof entry === 'string')
      .map(main => {
        // Default to index file if no main field find
        if (!main || main === '.' || main === './') {
          main = 'index';
        }

        invariant(typeof main === 'string');
        return path.resolve(dir, main);
      });
  }

  getModuleParts(name: ModuleSpecifier): Array<string> {
    let parts = path.normalize(name).split(path.sep);
    if (parts[0].charAt(0) === '@') {
      // Scoped module (e.g. @scope/module). Merge the first two parts back together.
      parts.splice(0, 2, `${parts[0]}/${parts[1]}`);
    }

    return parts;
  }

  isBuiltin(name: ModuleSpecifier): boolean {
    return !!builtins[name];
  }

  findNodeModulePath(
    id: ModuleSpecifier,
    dir: FilePath,
  ): ?ResolveResult | ?ModuleInfo {
    if (this.isBuiltin(id)) {
      return {resolved: id};
    }

    let [moduleName, ...parts] = this.getModuleParts(id);
    let moduleDir = this.fs.findNodeModule(moduleName, dir);

    if (!moduleDir && process.versions.pnp != null) {
      try {
        let pnp = Module.findPnpApi(dir + '/');

        moduleDir = pnp.resolveToUnqualified(
          moduleName +
            // retain slash in `require('assert/')` to force loading builtin from npm
            (id[moduleName.length] === '/' ? '/' : ''),
          dir + '/',
        );
      } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
          throw e;
        }
      }
    }

    if (moduleDir) {
      return {
        moduleName,
        subPath: path.join(...parts),
        moduleDir: moduleDir,
        filePath: parts.length > 0 ? path.join(moduleDir, ...parts) : moduleDir,
      };
    }

    return null;
  }
}

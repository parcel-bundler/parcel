// @flow

import type {FilePath, ModuleSpecifier, PackageJSON} from '@parcel/types';
import type {ResolveResult} from './NodeResolverBase';
import path from 'path';
import {NodeResolverBase} from './NodeResolverBase';

export class NodeResolverSync extends NodeResolverBase<ResolveResult> {
  resolve(id: ModuleSpecifier, from: FilePath): ResolveResult {
    if (id[0] === '.') {
      id = path.resolve(from, id);
    }

    let res;
    if (path.isAbsolute(id)) {
      res = this.loadRelative(id);
    } else {
      res = this.loadNodeModules(id, from);
    }

    if (!res) {
      let e = new Error(`Could not resolve module "${id}" from "${from}"`);
      // $FlowFixMe
      e.code = 'MODULE_NOT_FOUND';
      throw e;
    }

    return res;
  }

  loadRelative(id: FilePath): ?ResolveResult {
    // Find a package.json file in the current package.
    let pkg = this.findPackage(path.dirname(id));

    // First try as a file, then as a directory.
    return this.loadAsFile(id, pkg) || this.loadDirectory(id, pkg);
  }

  findPackage(dir: FilePath): ?PackageJSON {
    // Find the nearest package.json file within the current node_modules folder
    let pkgFile = this.fs.findAncestorFile(['package.json'], dir);
    if (pkgFile != null) {
      return this.readPackage(pkgFile);
    }
  }

  readPackage(file: FilePath): PackageJSON {
    let cached = this.packageCache.get(file);

    if (cached) {
      return cached;
    }

    let json = this.fs.readFileSync(file, 'utf8');
    let pkg = JSON.parse(json);

    this.packageCache.set(file, pkg);
    return pkg;
  }

  loadAsFile(file: FilePath, pkg: ?PackageJSON): ?ResolveResult {
    // Try all supported extensions
    let found = this.fs.findFirstFile(this.expandFile(file));
    if (found) {
      return {resolved: found, pkg};
    }

    return null;
  }

  loadDirectory(dir: FilePath, pkg: ?PackageJSON = null): ?ResolveResult {
    try {
      pkg = this.readPackage(dir + '/package.json');

      // Get a list of possible package entry points.
      let entries = this.getPackageEntries(dir, pkg);

      for (let file of entries) {
        // First try loading package.main as a file, then try as a directory.
        const res = this.loadAsFile(file, pkg) || this.loadDirectory(file, pkg);
        if (res) {
          return res;
        }
      }
    } catch (err) {
      // ignore
    }

    // Fall back to an index file inside the directory.
    return this.loadAsFile(path.join(dir, 'index'), pkg);
  }

  loadNodeModules(id: ModuleSpecifier, from: FilePath): ?ResolveResult {
    try {
      let module = this.findNodeModulePath(id, from);
      if (!module || module.resolved) {
        return module;
      }

      // If a module was specified as a module sub-path (e.g. some-module/some/path),
      // it is likely a file. Try loading it as a file first.
      if (module.subPath) {
        let pkg = this.readPackage(module.moduleDir + '/package.json');
        let res = this.loadAsFile(module.filePath, pkg);
        if (res) {
          return res;
        }
      }

      // Otherwise, load as a directory.
      if (module.filePath) {
        return this.loadDirectory(module.filePath);
      }
    } catch (e) {
      // ignore
    }
  }
}

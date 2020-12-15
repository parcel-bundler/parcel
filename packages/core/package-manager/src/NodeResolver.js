// @flow

import type {FilePath, ModuleSpecifier, PackageJSON} from '@parcel/types';
import type {ResolveResult} from './NodeResolverBase';
import type {FileSystem} from '@parcel/fs';
import path from 'path';
import {NodeResolverBase} from './NodeResolverBase';
import {NodeFS} from '@parcel/fs';

const NODE_MODULES = path.sep + 'node_modules' + path.sep;

export class NodeResolver extends NodeResolverBase<Promise<ResolveResult>> {
  async resolve(id: ModuleSpecifier, from: FilePath): Promise<ResolveResult> {
    if (id[0] === '.') {
      id = path.resolve(from, id);
    }

    let res;
    if (path.isAbsolute(id)) {
      res = await this.loadRelative(id);
    } else {
      res = await this.loadNodeModules(id, from);
    }

    if (!res) {
      let e = new Error(`Could not resolve module "${id}" from "${from}"`);
      e.code = 'MODULE_NOT_FOUND';
      throw e;
    }

    return res;
  }

  async loadRelative(id: FilePath) {
    // Find a package.json file in the current package.
    let pkg = await this.findPackage(path.dirname(id));

    // First try as a file, then as a directory.
    return (
      (await this.loadAsFile(id, pkg)) || (await this.loadDirectory(id, pkg)) // eslint-disable-line no-return-await
    );
  }

  findPackage(dir: FilePath) {
    let pkgFile = this.fs.findAncestorFile(['package.json'], dir);
    return this.readPackage(pkgFile);
  }

  async readPackage(file: FilePath): Promise<PackageJSON> {
    let cached = this.packageCache.get(file);

    if (cached) {
      return cached;
    }

    let json = await this.fs.readFile(file, 'utf8');
    let pkg = JSON.parse(json);

    this.packageCache.set(file, pkg);
    return pkg;
  }

  async loadAsFile(file: FilePath, pkg: ?PackageJSON) {
    // Try all supported extensions
    let found = this.fs.findFirstFile(this.expandFile(file));
    if (found) {
      return {resolved: found, pkg};
    }

    return null;
  }

  async loadDirectory(dir: FilePath, pkg: ?PackageJSON = null) {
    try {
      pkg = await this.readPackage(dir + '/package.json');

      // Get a list of possible package entry points.
      let entries = this.getPackageEntries(dir, pkg);

      for (let file of entries) {
        // First try loading package.main as a file, then try as a directory.
        const res =
          (await this.loadAsFile(file, pkg)) ||
          (await this.loadDirectory(file, pkg));
        if (res) {
          return res;
        }
      }
    } catch (err) {
      console.log(err);
      // ignore
    }

    // Fall back to an index file inside the directory.
    return this.loadAsFile(path.join(dir, 'index'), pkg);
  }

  async loadNodeModules(id: ModuleSpecifier, from: FilePath) {
    try {
      let module = await this.findNodeModulePath(id, from);
      if (!module || module.resolved) {
        return module;
      }

      // If a module was specified as a module sub-path (e.g. some-module/some/path),
      // it is likely a file. Try loading it as a file first.
      if (module.subPath) {
        let pkg = await this.readPackage(module.moduleDir + '/package.json');
        let res = await this.loadAsFile(module.filePath, pkg);
        if (res) {
          return res;
        }
      }

      // Otherwise, load as a directory.
      if (module.filePath) {
        return await this.loadDirectory(module.filePath);
      }
    } catch (e) {
      // ignore
    }
  }

  findNodeModulePath(id: ModuleSpecifier, dir: FilePath) {
    if (this.isBuiltin(id)) {
      return {resolved: id};
    }

    let parts = this.getModuleParts(id);
    let moduleDir = this.fs.findNodeModule(parts[0], dir);
    if (moduleDir) {
      return {
        moduleName: parts[0],
        subPath: parts[1],
        moduleDir: moduleDir,
        filePath:
          parts.length > 1
            ? path.join(moduleDir, ...parts.slice(1))
            : moduleDir,
      };
    }

    return null;
  }
}

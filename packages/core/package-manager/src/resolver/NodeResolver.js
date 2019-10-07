// @flow

import type {FilePath, ModuleSpecifier} from '@parcel/types';
import type {ResolveResult, InternalPackageJSON} from './NodeResolverBase';
import type {FileSystem} from '@parcel/fs';
import path from 'path';
import {NodeResolverBase} from './NodeResolverBase';

export class NodeResolver extends NodeResolverBase<Promise<ResolveResult>> {
  constructor(fs: FileSystem, extensions?: Array<string>) {
    super(fs, extensions);
    this.statCache = new Map();
  }

  async resolveUncached(
    id: ModuleSpecifier,
    from: FilePath
  ): Promise<ResolveResult> {
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
      throw new Error(`Could not resolve module "${id}" from "${from}"`);
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

  async findPackage(dir: FilePath) {
    // Find the nearest package.json file within the current node_modules folder
    let root = path.parse(dir).root;
    while (dir !== root && path.basename(dir) !== 'node_modules') {
      let file = path.join(dir, 'package.json');
      if (await this.isFile(file)) {
        return this.readPackage(dir);
      }

      dir = path.dirname(dir);
    }

    return null;
  }

  async readPackage(dir: FilePath): Promise<InternalPackageJSON> {
    let file = path.join(dir, 'package.json');
    let cached = this.packageCache.get(file);

    if (cached) {
      return cached;
    }

    let json = await this.fs.readFile(file, 'utf8');
    let pkg = JSON.parse(json);

    pkg.pkgfile = file;
    pkg.pkgdir = dir;

    this.packageCache.set(file, pkg);
    return pkg;
  }

  async loadAsFile(file: FilePath, pkg: ?InternalPackageJSON) {
    // Try all supported extensions
    for (let f of this.expandFile(file)) {
      if (await this.isFile(f)) {
        return {resolved: f, pkg};
      }
    }
  }

  stat(file: FilePath) {
    if (this.statCache.has(file)) {
      return this.statCache.get(file);
    }

    let statPromise = this.fs.stat(file);
    this.statCache.set(file, statPromise);
    return statPromise;
  }

  async isFile(file: FilePath) {
    try {
      let stat = await this.stat(file);
      return stat.isFile() || stat.isFIFO();
    } catch (err) {
      return false;
    }
  }

  async loadDirectory(dir: FilePath, pkg: ?InternalPackageJSON = null) {
    try {
      pkg = await this.readPackage(dir);

      // Get a list of possible package entry points.
      let entries = this.getPackageEntries(pkg);

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
        let pkg = await this.readPackage(module.moduleDir);
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

  async findNodeModulePath(id: ModuleSpecifier, dir: FilePath) {
    if (this.isBuiltin(id)) {
      return {resolved: id};
    }

    let parts = this.getModuleParts(id);
    let root = path.parse(dir).root;

    while (dir !== root) {
      // Skip node_modules directories
      if (path.basename(dir) === 'node_modules') {
        dir = path.dirname(dir);
      }

      try {
        // First, check if the module directory exists. This prevents a lot of unnecessary checks later.
        let moduleDir = path.join(dir, 'node_modules', parts[0]);
        let stats = await this.stat(moduleDir);
        if (stats.isDirectory()) {
          return {
            moduleName: parts[0],
            subPath: parts[1],
            moduleDir: moduleDir,
            filePath: path.join(dir, 'node_modules', id)
          };
        }
      } catch (err) {
        // ignore
      }

      // Move up a directory
      dir = path.dirname(dir);
    }
  }
}

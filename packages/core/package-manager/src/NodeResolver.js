// @flow

import type {FilePath, ModuleSpecifier} from '@parcel/types';
import type {ResolveResult, InternalPackageJSON} from './NodeResolverBase';
import type {FileSystem} from '@parcel/fs';
import path from 'path';
import {NodeResolverBase} from './NodeResolverBase';
import {
  find_file,
  find_file_async,
  find_first_file,
  find_node_module,
} from '@parcel/fs-search';
import {NodeFS} from '@parcel/fs';

const NODE_MODULES = path.sep + 'node_modules' + path.sep;

export class NodeResolver extends NodeResolverBase<Promise<ResolveResult>> {
  async resolveUncached(
    id: ModuleSpecifier,
    from: FilePath,
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

  findPackage(dir: FilePath) {
    let index = dir.lastIndexOf(NODE_MODULES);
    let root = index >= 0 ? dir.slice(0, index + NODE_MODULES.length - 1) : '/';
    let pkgFile = find_file(this.fs, dir + '/index', ['package.json'], root);
    return this.readPackage(pkgFile);
  }

  async readPackage(file: FilePath): Promise<InternalPackageJSON> {
    let cached = this.packageCache.get(file);

    if (cached) {
      return cached;
    }

    let json = await this.fs.readFile(file, 'utf8');
    let pkg = JSON.parse(json);

    pkg.pkgfile = file;
    pkg.pkgdir = path.dirname(file);

    this.packageCache.set(file, pkg);
    return pkg;
  }

  async loadAsFile(file: FilePath, pkg: ?InternalPackageJSON) {
    // Try all supported extensions
    let found = find_first_file(this.fs, this.expandFile(file));
    if (found) {
      return {resolved: found, pkg};
    }

    return null;
  }

  async loadDirectory(dir: FilePath, pkg: ?InternalPackageJSON = null) {
    try {
      pkg = await this.readPackage(dir + '/package.json');

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
    let root = path.parse(dir).root;

    let moduleDir = find_node_module(this.fs, parts[0], dir + '/index', root);
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

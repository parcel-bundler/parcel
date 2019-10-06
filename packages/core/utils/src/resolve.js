// @flow strict-local

import type {PackageJSON, FilePath, ModuleSpecifier} from '@parcel/types';
import type {ResolveOptions} from 'resolve';
import type {FileSystem} from '@parcel/fs';
import Module from 'module';

// $FlowFixMe TODO: Type promisify
import promisify from './promisify';
import _resolve from 'resolve';
import path from 'path';

const builtins = {};
for (let builtin of Module.builtinModules) {
  builtins[builtin] = true;
}

const resolveAsync = promisify(_resolve);

export type ResolveResult = {|
  resolved: FilePath | ModuleSpecifier,
  pkg?: ?PackageJSON
|};

export class NodeResolver {
  fs: FileSystem;
  packageCache: Map<string, InternalPackageJSON>;

  constructor(fs: FileSystem) {
    this.fs = fs;
    this.packageCache = new Map();
    this.statCache = new Map();
  }

  async resolve(id: string, opts?: ResolveOptions) {
    if (id[0] === '.') {
      id = path.resolve(opts.basedir, id);
    }

    let res;
    if (path.isAbsolute(id)) {
      res = await this.loadRelative(id, opts);
    } else {
      res = await this.loadNodeModules(id, opts);
    }

    if (!res) {
      throw new Error(
        `Could not resolve module "${id}" from "${opts.basedir}"`
      );
    }

    return res;
  }

  async loadRelative(id, opts) {
    // Find a package.json file in the current package.
    let pkg = await this.findPackage(path.dirname(id));

    // First try as a file, then as a directory.
    return (
      (await this.loadAsFile(id, opts.extensions, pkg)) ||
      (await this.loadDirectory(id, opts.extensions, pkg)) // eslint-disable-line no-return-await
    );
  }

  async findPackage(dir: string) {
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

  async readPackage(dir: string): Promise<InternalPackageJSON> {
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

  async loadAsFile(
    file: string,
    extensions: Array<string>,
    pkg: InternalPackageJSON | null
  ) {
    // Try all supported extensions
    for (let f of await this.expandFile(file, extensions, pkg)) {
      if (await this.isFile(f)) {
        return {resolved: f, pkg};
      }
    }
  }

  async expandFile(
    file: string,
    extensions: Array<string>,
    pkg: InternalPackageJSON | null
  ) {
    // Expand extensions and aliases
    let res = [];
    for (let ext of extensions) {
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

  stat(file) {
    if (this.statCache.has(file)) {
      return this.statCache.get(file);
    }

    let statPromise = this.fs.stat(file);
    this.statCache.set(file, statPromise);
    return statPromise;
  }

  async isFile(file) {
    try {
      let stat = await this.stat(file);
      return stat.isFile() || stat.isFIFO();
    } catch (err) {
      return false;
    }
  }

  async loadDirectory(
    dir: string,
    extensions: Array<string>,
    pkg: InternalPackageJSON | null = null
  ) {
    try {
      pkg = await this.readPackage(dir);

      // Get a list of possible package entry points.
      let entries = this.getPackageEntries(pkg);

      for (let file of entries) {
        // First try loading package.main as a file, then try as a directory.
        const res =
          (await this.loadAsFile(file, extensions, pkg)) ||
          (await this.loadDirectory(file, extensions, pkg));
        if (res) {
          return res;
        }
      }
    } catch (err) {
      // ignore
    }

    // Fall back to an index file inside the directory.
    return this.loadAsFile(path.join(dir, 'index'), extensions, pkg);
  }

  getPackageEntries(pkg) {
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

  async loadNodeModules(id, opts) {
    try {
      let module = await this.findNodeModulePath(id, opts.basedir);
      if (!module) {
        return null;
      }

      // If a module was specified as a module sub-path (e.g. some-module/some/path),
      // it is likely a file. Try loading it as a file first.
      if (module.subPath) {
        let pkg = await this.readPackage(module.moduleDir);
        let res = await this.loadAsFile(module.filePath, opts.extensions, pkg);
        if (res) {
          return res;
        }
      }

      // Otherwise, load as a directory.
      return await this.loadDirectory(module.filePath, opts.extensions);
    } catch (e) {
      // ignore
    }
  }

  async findNodeModulePath(filename: string, dir: string) {
    if (builtins[filename]) {
      // if (this.options.cli.target === 'node' && filename in nodeBuiltins) {
      //   throw new Error('Cannot resolve builtin module for node target');
      // }

      return {resolved: builtins[filename]};
    }

    let parts = this.getModuleParts(filename);
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
            filePath: path.join(dir, 'node_modules', filename)
          };
        }
      } catch (err) {
        // ignore
      }

      // Move up a directory
      dir = path.dirname(dir);
    }
  }

  getModuleParts(name) {
    let parts = path.normalize(name).split(path.sep);
    if (parts[0].charAt(0) === '@') {
      // Scoped module (e.g. @scope/module). Merge the first two parts back together.
      parts.splice(0, 2, `${parts[0]}/${parts[1]}`);
    }

    return parts;
  }
}

export class NodeResolverSync {
  fs: FileSystem;
  packageCache: Map<string, InternalPackageJSON>;

  constructor(fs: FileSystem) {
    this.fs = fs;
    this.packageCache = new Map();
    this.statCache = new Map();
  }

  resolve(id: string, opts?: ResolveOptions) {
    if (id[0] === '.') {
      id = path.resolve(opts.basedir, id);
    }

    let res;
    if (path.isAbsolute(id)) {
      res = this.loadRelative(id, opts);
    } else {
      res = this.loadNodeModules(id, opts);
    }

    if (!res) {
      throw new Error(
        `Could not resolve module "${id}" from "${opts.basedir}"`
      );
    }

    return res;
  }

  loadRelative(id, opts) {
    // Find a package.json file in the current package.
    let pkg = this.findPackage(path.dirname(id));

    // First try as a file, then as a directory.
    return (
      this.loadAsFile(id, opts.extensions, pkg) ||
      this.loadDirectory(id, opts.extensions, pkg) // eslint-disable-line no-return-await
    );
  }

  findPackage(dir: string) {
    // Find the nearest package.json file within the current node_modules folder
    let root = path.parse(dir).root;
    while (dir !== root && path.basename(dir) !== 'node_modules') {
      let file = path.join(dir, 'package.json');
      if (this.isFile(file)) {
        return this.readPackage(dir);
      }

      dir = path.dirname(dir);
    }

    return null;
  }

  readPackage(dir: string): Promise<InternalPackageJSON> {
    let file = path.join(dir, 'package.json');
    let cached = this.packageCache.get(file);

    if (cached) {
      return cached;
    }

    let json = this.fs.readFileSync(file, 'utf8');
    let pkg = JSON.parse(json);

    pkg.pkgfile = file;
    pkg.pkgdir = dir;

    this.packageCache.set(file, pkg);
    return pkg;
  }

  loadAsFile(
    file: string,
    extensions: Array<string>,
    pkg: InternalPackageJSON | null
  ) {
    // Try all supported extensions
    for (let f of this.expandFile(file, extensions, pkg)) {
      if (this.isFile(f)) {
        return {resolved: f, pkg};
      }
    }
  }

  expandFile(
    file: string,
    extensions: Array<string>,
    pkg: InternalPackageJSON | null
  ) {
    // Expand extensions and aliases
    let res = [];
    for (let ext of extensions) {
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

  statSync(file) {
    if (this.statCache.has(file)) {
      let res = this.statCache.get(file);
      if (res instanceof Error) {
        throw res;
      }
      return res;
    }

    try {
      let stat = this.fs.statSync(file);
      this.statCache.set(file, stat);
      return stat;
    } catch (err) {
      this.statCache.set(file, err);
      throw err;
    }
  }

  isFile(file) {
    try {
      let stat = this.statSync(file);
      return stat.isFile() || stat.isFIFO();
    } catch (err) {
      return false;
    }
  }

  loadDirectory(
    dir: string,
    extensions: Array<string>,
    pkg: InternalPackageJSON | null = null
  ) {
    try {
      pkg = this.readPackage(dir);

      // Get a list of possible package entry points.
      let entries = this.getPackageEntries(pkg);

      for (let file of entries) {
        // First try loading package.main as a file, then try as a directory.
        const res =
          this.loadAsFile(file, extensions, pkg) ||
          this.loadDirectory(file, extensions, pkg);
        if (res) {
          return res;
        }
      }
    } catch (err) {
      // ignore
    }

    // Fall back to an index file inside the directory.
    return this.loadAsFile(path.join(dir, 'index'), extensions, pkg);
  }

  getPackageEntries(pkg) {
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

  loadNodeModules(id, opts) {
    try {
      let module = this.findNodeModulePath(id, opts.basedir);
      if (!module || module.resolved) {
        return module;
      }

      // If a module was specified as a module sub-path (e.g. some-module/some/path),
      // it is likely a file. Try loading it as a file first.
      if (module.subPath) {
        let pkg = this.readPackage(module.moduleDir);
        let res = this.loadAsFile(module.filePath, opts.extensions, pkg);
        if (res) {
          return res;
        }
      }

      // Otherwise, load as a directory.
      return this.loadDirectory(module.filePath, opts.extensions);
    } catch (e) {
      // ignore
    }
  }

  findNodeModulePath(filename: string, dir: string) {
    if (builtins[filename]) {
      // if (this.options.cli.target === 'node' && filename in nodeBuiltins) {
      //   throw new Error('Cannot resolve builtin module for node target');
      // }

      return {resolved: filename};
    }

    let parts = this.getModuleParts(filename);
    let root = path.parse(dir).root;

    while (dir !== root) {
      // Skip node_modules directories
      if (path.basename(dir) === 'node_modules') {
        dir = path.dirname(dir);
      }

      try {
        // First, check if the module directory exists. This prevents a lot of unnecessary checks later.
        let moduleDir = path.join(dir, 'node_modules', parts[0]);
        let stats = this.statSync(moduleDir);
        if (stats.isDirectory()) {
          return {
            moduleName: parts[0],
            subPath: parts[1],
            moduleDir: moduleDir,
            filePath: path.join(dir, 'node_modules', filename)
          };
        }
      } catch (err) {
        // ignore
      }

      // Move up a directory
      dir = path.dirname(dir);
    }
  }

  getModuleParts(name) {
    let parts = path.normalize(name).split(path.sep);
    if (parts[0].charAt(0) === '@') {
      // Scoped module (e.g. @scope/module). Merge the first two parts back together.
      parts.splice(0, 2, `${parts[0]}/${parts[1]}`);
    }

    return parts;
  }
}

export async function resolve(
  fs: FileSystem,
  id: string,
  opts?: ResolveOptions
): Promise<ResolveResult> {
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

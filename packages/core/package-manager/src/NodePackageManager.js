// @flow
import type {FilePath, ModuleSpecifier, SemverRange} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {
  ModuleRequest,
  PackageManager,
  PackageInstaller,
  InstallOptions,
  Invalidations,
} from './types';
import type {ResolveResult} from './NodeResolverBase';

import {registerSerializableClass} from '@parcel/core';
import ThrowableDiagnostic, {
  encodeJSONKeyComponent,
  escapeMarkdown,
  generateJSONCodeHighlights,
  md,
} from '@parcel/diagnostic';
import nativeFS from 'fs';
// $FlowFixMe this is untyped
import Module from 'module';
import path from 'path';
import semver from 'semver';

import {getConflictingLocalDependencies} from './utils';
import {installPackage} from './installPackage';
import pkg from '../package.json';
import {NodeResolver} from './NodeResolver';
import {NodeResolverSync} from './NodeResolverSync';

// There can be more than one instance of NodePackageManager, but node has only a single module cache.
// Therefore, the resolution cache and the map of parent to child modules should also be global.
const cache = new Map<ModuleSpecifier, ResolveResult>();
const children = new Map<FilePath, Set<ModuleSpecifier>>();

// This implements a package manager for Node by monkey patching the Node require
// algorithm so that it uses the specified FileSystem instead of the native one.
// It also handles installing packages when they are required if not already installed.
// See https://github.com/nodejs/node/blob/master/lib/internal/modules/cjs/loader.js
// for reference to Node internals.
export class NodePackageManager implements PackageManager {
  fs: FileSystem;
  installer: ?PackageInstaller;
  resolver: NodeResolver;
  syncResolver: NodeResolverSync;

  constructor(fs: FileSystem, installer?: ?PackageInstaller) {
    this.fs = fs;
    this.installer = installer;
    this.resolver = new NodeResolver(this.fs);
    this.syncResolver = new NodeResolverSync(this.fs);
  }

  static deserialize(opts: any): NodePackageManager {
    return new NodePackageManager(opts.fs, opts.installer);
  }

  serialize(): {|
    $$raw: boolean,
    fs: FileSystem,
    installer: ?PackageInstaller,
  |} {
    return {
      $$raw: false,
      fs: this.fs,
      installer: this.installer,
    };
  }

  async require(
    name: ModuleSpecifier,
    from: FilePath,
    opts: ?{|
      range?: SemverRange,
      shouldAutoInstall?: boolean,
      saveDev?: boolean,
    |},
  ): Promise<any> {
    let {resolved} = await this.resolve(name, from, opts);
    return this.load(resolved, from);
  }

  requireSync(name: ModuleSpecifier, from: FilePath): any {
    let {resolved} = this.resolveSync(name, from);
    return this.load(resolved, from);
  }

  load(filePath: FilePath, from: FilePath): any {
    if (!path.isAbsolute(filePath)) {
      // Node builtin module
      // $FlowFixMe
      return require(filePath);
    }

    const cachedModule = Module._cache[filePath];
    if (cachedModule !== undefined) {
      return cachedModule.exports;
    }

    let m = new Module(filePath, Module._cache[from] || module.parent);
    Module._cache[filePath] = m;

    // Patch require within this module so it goes through our require
    m.require = id => {
      return this.requireSync(id, filePath);
    };

    // Patch `fs.readFileSync` temporarily so that it goes through our file system
    let readFileSync = nativeFS.readFileSync;
    // $FlowFixMe
    nativeFS.readFileSync = (filename, encoding) => {
      // $FlowFixMe
      nativeFS.readFileSync = readFileSync;
      return this.fs.readFileSync(filename, encoding);
    };

    try {
      m.load(filePath);
    } catch (err) {
      delete Module._cache[filePath];
      throw err;
    }

    return m.exports;
  }

  async resolve(
    name: ModuleSpecifier,
    from: FilePath,
    options?: ?{|
      range?: string,
      shouldAutoInstall?: boolean,
      saveDev?: boolean,
    |},
  ): Promise<ResolveResult> {
    let basedir = path.dirname(from);
    let key = basedir + ':' + name;
    let resolved = cache.get(key);
    if (!resolved) {
      try {
        resolved = await this.resolver.resolve(name, from);
      } catch (e) {
        if (
          e.code !== 'MODULE_NOT_FOUND' ||
          options?.shouldAutoInstall !== true
        ) {
          if (
            e.code === 'MODULE_NOT_FOUND' &&
            options?.shouldAutoInstall !== true
          ) {
            let err = new ThrowableDiagnostic({
              diagnostic: {
                message: escapeMarkdown(e.message),
                hints: [
                  'Autoinstall is disabled, please install this package manually and restart Parcel.',
                ],
              },
            });
            // $FlowFixMe - needed for loadParcelPlugin
            err.code = 'MODULE_NOT_FOUND';
            throw err;
          } else {
            throw e;
          }
        }

        let conflicts = await getConflictingLocalDependencies(
          this.fs,
          name,
          from,
        );

        if (conflicts == null) {
          await this.install([{name, range: options?.range}], from, {
            saveDev: options?.saveDev ?? true,
          });

          return this.resolve(name, from, {
            ...options,
            shouldAutoInstall: false,
          });
        }

        throw new ThrowableDiagnostic({
          diagnostic: conflicts.fields.map(field => ({
            message: md`Could not find module "${name}", but it was listed in package.json. Run your package manager first.`,
            filePath: conflicts.filePath,
            origin: '@parcel/package-manager',
            language: 'json',
            codeFrame: {
              code: conflicts.json,
              codeHighlights: generateJSONCodeHighlights(conflicts.json, [
                {
                  key: `/${field}/${encodeJSONKeyComponent(name)}`,
                  type: 'key',
                  message: 'Defined here, but not installed',
                },
              ]),
            },
          })),
        });
      }

      let range = options?.range;
      if (range != null) {
        let pkg = resolved.pkg;
        if (pkg == null || !semver.satisfies(pkg.version, range)) {
          let conflicts = await getConflictingLocalDependencies(
            this.fs,
            name,
            from,
          );

          if (conflicts == null && options?.shouldAutoInstall === true) {
            await this.install([{name, range}], from);
            return this.resolve(name, from, {
              ...options,
              shouldAutoInstall: false,
            });
          } else if (conflicts != null) {
            throw new ThrowableDiagnostic({
              diagnostic: {
                message: md`Could not find module "${name}" satisfying ${range}.`,
                filePath: conflicts.filePath,
                origin: '@parcel/package-manager',
                language: 'json',
                codeFrame: {
                  code: conflicts.json,
                  codeHighlights: generateJSONCodeHighlights(
                    conflicts.json,
                    conflicts.fields.map(field => ({
                      key: `/${field}/${encodeJSONKeyComponent(name)}`,
                      type: 'key',
                      message: 'Found this conflicting local requirement.',
                    })),
                  ),
                },
              },
            });
          }

          let version = pkg?.version;
          let message = md`Could not resolve package "${name}" that satisfies ${range}.`;
          if (version != null) {
            message += md` Found ${version}.`;
          }

          throw new ThrowableDiagnostic({
            diagnostic: {
              message,
              hints: [
                'Looks like the incompatible version was installed transitively. Add this package as a direct dependency with a compatible version range.',
              ],
            },
          });
        }
      }

      cache.set(key, resolved);

      // Add the specifier as a child to the parent module.
      // Don't do this if the specifier was an absolute path, as this was likely a dynamically resolved path
      // (e.g. babel uses require() to load .babelrc.js configs and we don't want them to be added  as children of babel itself).
      if (!path.isAbsolute(name)) {
        let moduleChildren = children.get(from);
        if (!moduleChildren) {
          moduleChildren = new Set();
          children.set(from, moduleChildren);
        }

        moduleChildren.add(name);
      }
    }

    return resolved;
  }

  resolveSync(name: ModuleSpecifier, from: FilePath): ResolveResult {
    let basedir = path.dirname(from);
    let key = basedir + ':' + name;
    let resolved = cache.get(key);
    if (!resolved) {
      resolved = this.syncResolver.resolve(name, from);
      cache.set(key, resolved);

      if (!path.isAbsolute(name)) {
        let moduleChildren = children.get(from);
        if (!moduleChildren) {
          moduleChildren = new Set();
          children.set(from, moduleChildren);
        }

        moduleChildren.add(name);
      }
    }

    return resolved;
  }

  async install(
    modules: Array<ModuleRequest>,
    from: FilePath,
    opts?: InstallOptions,
  ) {
    await installPackage(this.fs, this, modules, from, {
      packageInstaller: this.installer,
      ...opts,
    });
  }

  getInvalidations(name: ModuleSpecifier, from: FilePath): Invalidations {
    let res = {
      invalidateOnFileCreate: [],
      invalidateOnFileChange: new Set(),
    };

    let seen = new Set();
    let addKey = (name, from) => {
      let basedir = path.dirname(from);
      let key = basedir + ':' + name;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      let resolved = cache.get(key);
      if (!resolved || !path.isAbsolute(resolved.resolved)) {
        return;
      }

      res.invalidateOnFileCreate.push(...resolved.invalidateOnFileCreate);
      res.invalidateOnFileChange.add(resolved.resolved);

      for (let file of resolved.invalidateOnFileChange) {
        res.invalidateOnFileChange.add(file);
      }

      let moduleChildren = children.get(resolved.resolved);
      if (moduleChildren) {
        for (let specifier of moduleChildren) {
          addKey(specifier, resolved.resolved);
        }
      }
    };

    addKey(name, from);
    return res;
  }

  invalidate(name: ModuleSpecifier, from: FilePath) {
    let seen = new Set();

    let invalidate = (name, from) => {
      let basedir = path.dirname(from);
      let key = basedir + ':' + name;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      let resolved = cache.get(key);
      if (!resolved || !path.isAbsolute(resolved.resolved)) {
        return;
      }

      let module = require.cache[resolved.resolved];
      if (module) {
        delete require.cache[resolved.resolved];
      }

      let moduleChildren = children.get(resolved.resolved);
      if (moduleChildren) {
        for (let specifier of moduleChildren) {
          invalidate(specifier, resolved.resolved);
        }
      }

      children.delete(resolved.resolved);
      cache.delete(key);
      this.resolver.invalidate(resolved.resolved);
      this.syncResolver.invalidate(resolved.resolved);
    };

    invalidate(name, from);
  }
}

registerSerializableClass(
  `${pkg.version}:NodePackageManager`,
  NodePackageManager,
);

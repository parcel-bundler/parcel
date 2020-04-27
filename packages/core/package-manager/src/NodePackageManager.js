// @flow
import type {FilePath, ModuleSpecifier, SemverRange} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {
  ModuleRequest,
  PackageManager,
  PackageInstaller,
  InstallOptions,
} from './types';
import type {ResolveResult} from '@parcel/utils';

import {resolve, resolveSync} from '@parcel/utils';
import {registerSerializableClass} from '@parcel/core';
import ThrowableDiagnostic, {
  encodeJSONKeyComponent,
  generateJSONCodeHighlights,
} from '@parcel/diagnostic';
import nativeFS from 'fs';
// $FlowFixMe this is untyped
import Module from 'module';
import path from 'path';
import semver from 'semver';

import {getConflictingLocalDependencies} from './utils';
import {installPackage} from './installPackage';
import pkg from '../package.json';

// This implements a package manager for Node by monkey patching the Node require
// algorithm so that it uses the specified FileSystem instead of the native one.
// It also handles installing packages when they are required if not already installed.
// See https://github.com/nodejs/node/blob/master/lib/internal/modules/cjs/loader.js
// for reference to Node internals.
export class NodePackageManager implements PackageManager {
  fs: FileSystem;
  installer: ?PackageInstaller;
  cache: Map<ModuleSpecifier, ResolveResult> = new Map();

  constructor(fs: FileSystem, installer?: ?PackageInstaller) {
    this.fs = fs;
    this.installer = installer;
  }

  static deserialize(opts: any) {
    return new NodePackageManager(opts.fs, opts.installer);
  }

  serialize() {
    return {
      $$raw: false,
      fs: this.fs,
      installer: this.installer,
    };
  }

  async require(
    name: ModuleSpecifier,
    from: FilePath,
    opts: ?{|range?: SemverRange, autoinstall?: boolean, saveDev?: boolean|},
  ) {
    let {resolved} = await this.resolve(name, from, opts);
    return this.load(resolved, from);
  }

  requireSync(name: ModuleSpecifier, from: FilePath) {
    let {resolved} = this.resolveSync(name, from);
    return this.load(resolved, from);
  }

  load(resolved: FilePath, from: FilePath) {
    if (!path.isAbsolute(resolved)) {
      // Node builtin module
      // $FlowFixMe
      return require(resolved);
    }

    let filePath = this.fs.realpathSync(resolved);
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
    options?: ?{|range?: string, autoinstall?: boolean, saveDev?: boolean|},
  ) {
    let basedir = path.dirname(from);
    let key = basedir + ':' + name;
    let resolved = this.cache.get(key);
    if (!resolved) {
      try {
        resolved = await resolve(this.fs, name, {
          basedir,
          extensions: Object.keys(Module._extensions),
        });
      } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND' || options?.autoinstall === false) {
          throw e;
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
            autoinstall: false,
          });
        }

        throw new ThrowableDiagnostic({
          diagnostic: conflicts.fields.map(field => ({
            message: `Could not find module "${name}", but it was listed in package.json. Run your package manager first.`,
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

          if (conflicts == null && options?.autoinstall !== false) {
            await this.install([{name, range}], from);
            return this.resolve(name, from, {
              ...options,
              autoinstall: false,
            });
          } else if (conflicts != null) {
            throw new ThrowableDiagnostic({
              diagnostic: {
                message: `Could not find module "${name}" satisfying ${range}.`,
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
          let message = `Could not resolve package "${name}" that satisfies ${range}.`;
          if (version != null) {
            message += ` Found ${version}.`;
          }

          throw new ThrowableDiagnostic({
            diagnostic: {
              message,
              origin: '@parcel/package-manager',
            },
          });
        }
      }

      this.cache.set(key, resolved);
    }

    return resolved;
  }

  resolveSync(name: ModuleSpecifier, from: FilePath) {
    let basedir = path.dirname(from);
    return resolveSync(this.fs, name, {
      basedir,
      extensions: Object.keys(Module._extensions),
    });
  }

  async install(
    modules: Array<ModuleRequest>,
    from: FilePath,
    opts?: InstallOptions,
  ) {
    await installPackage(this.fs, modules, from, {
      packageInstaller: this.installer,
      ...opts,
    });
  }
}

registerSerializableClass(
  `${pkg.version}:NodePackageManager`,
  NodePackageManager,
);

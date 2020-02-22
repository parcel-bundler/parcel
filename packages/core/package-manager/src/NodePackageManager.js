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

import {installPackage} from './installPackage';
import {dirname} from 'path';
import {resolve, resolveConfig, resolveSync} from '@parcel/utils';
import {registerSerializableClass} from '@parcel/core';
import pkg from '../package.json';
// $FlowFixMe
import Module from 'module';
import path from 'path';
import nativeFS from 'fs';
import Semver from 'semver';
import ThrowableDiagnostic, {
  encodeJSONKeyComponent,
  generateJSONCodeHighlights,
} from '@parcel/diagnostic';

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
    opts: ?{|range?: SemverRange, autoInstall?: boolean|},
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
    options?: ?{|range?: string, autoInstall?: boolean|},
  ) {
    let basedir = dirname(from);
    let key = basedir + ':' + name;
    let resolved = this.cache.get(key);
    if (!resolved) {
      try {
        resolved = await resolve(this.fs, name, {
          basedir,
          extensions: Object.keys(Module._extensions),
        });
      } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND' || options?.autoInstall === false) {
          throw e;
        }

        let conflicts = await getConflictingLocalDependencies(
          from,
          name,
          this.fs,
        );

        if (conflicts == null) {
          await this.install([{name, range: options?.range}], from);
          return this.resolve(name, from, {
            ...options,
            autoInstall: false,
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
        if (pkg == null || !Semver.satisfies(pkg.version, range)) {
          let conflicts = await getConflictingLocalDependencies(
            from,
            name,
            this.fs,
          );

          if (conflicts == null && options?.autoInstall !== false) {
            await this.install([{name, range}], from);
            return this.resolve(name, from, {
              ...options,
              autoInstall: false,
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
    let basedir = dirname(from);
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

async function getConflictingLocalDependencies(
  installPath: FilePath,
  name: string,
  fs: FileSystem,
): Promise<?{|json: string, filePath: FilePath, fields: Array<string>|}> {
  let pkgPath = await resolveConfig(fs, installPath, ['package.json']);
  if (pkgPath == null) {
    return;
  }

  let pkgStr = await fs.readFile(pkgPath, 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(pkgStr);
  } catch (e) {
    throw new ThrowableDiagnostic({
      diagnostic: {
        filePath: pkgPath,
        message: 'Failed to parse package.json',
        origin: '@parcel/package-manager',
      },
    });
  }

  if (typeof pkg !== 'object' || pkg == null) {
    throw new ThrowableDiagnostic({
      diagnostic: {
        filePath: pkgPath,
        message: 'Expected package.json contents to be an object.',
        origin: '@parcel/package-manager',
      },
    });
  }

  let fields = [];
  for (let field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (
      typeof pkg[field] === 'object' &&
      pkg[field] != null &&
      pkg[field][name] != null
    ) {
      fields.push(field);
    }
  }

  if (fields.length > 0) {
    return {
      filePath: pkgPath,
      json: pkgStr,
      fields,
    };
  }
}

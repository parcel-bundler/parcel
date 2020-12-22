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

import bundlerDefault from '@parcel/bundler-default';
import namerDefault from '@parcel/namer-default';
import optimizerTerser from '@parcel/optimizer-terser';
import packagerCss from '@parcel/packager-css';
import packagerHtml from '@parcel/packager-html';
import packagerJs from '@parcel/packager-js';
import packagerRaw from '@parcel/packager-raw';
import reporterJson from '@parcel/reporter-json';
import reporterServer from '@parcel/reporter-dev-server-sw';
import reporterSourcemapVisualizser from '@parcel/reporter-sourcemap-visualiser';
import resolverDefault from '@parcel/resolver-default';
import resolverREPLRuntimes from '@parcel/resolver-repl-runtimes';
import runtimeHMRSSE from '@parcel/runtime-browser-hmr-sse';
import runtimeJs from '@parcel/runtime-js';
import runtimeReactRefresh from '@parcel/runtime-react-refresh';
import transformerBabel from '@parcel/transformer-babel';
import transformerCss from '@parcel/transformer-css';
import transformerHtml from '@parcel/transformer-html';
import transformerInlineString from '@parcel/transformer-inline-string';
import transformerJs from '@parcel/transformer-js';
import transformerJson from '@parcel/transformer-json';
import transformerPostcss from '@parcel/transformer-postcss';
import transformerPosthtml from '@parcel/transformer-posthtml';
import transformerReactRefreshBabel from '@parcel/transformer-react-refresh-babel';
import transformerReactRefreshWrap from '@parcel/transformer-react-refresh-wrap';
import transformerRaw from '@parcel/transformer-raw';

const BUILTINS = {
  '@parcel/bundler-default': bundlerDefault,
  '@parcel/namer-default': namerDefault,
  '@parcel/optimizer-terser': optimizerTerser,
  '@parcel/packager-css': packagerCss,
  '@parcel/packager-html': packagerHtml,
  '@parcel/packager-js': packagerJs,
  '@parcel/packager-raw': packagerRaw,
  '@parcel/reporter-dev-server-sw': reporterServer,
  '@parcel/reporter-json': reporterJson,
  '@parcel/reporter-sourcemap-visualiser': reporterSourcemapVisualizser,
  '@parcel/resolver-default': resolverDefault,
  '@parcel/resolver-repl-runtimes': resolverREPLRuntimes,
  '@parcel/runtime-hmr-sse': runtimeHMRSSE,
  '@parcel/runtime-js': runtimeJs,
  '@parcel/runtime-react-refresh': runtimeReactRefresh,
  '@parcel/transformer-babel': transformerBabel,
  '@parcel/transformer-css': transformerCss,
  '@parcel/transformer-html': transformerHtml,
  '@parcel/transformer-react-refresh-babel': transformerReactRefreshBabel,
  '@parcel/transformer-react-refresh-wrap': transformerReactRefreshWrap,
  '@parcel/transformer-inline-string': transformerInlineString,
  '@parcel/transformer-js': transformerJs,
  '@parcel/transformer-json': transformerJson,
  '@parcel/transformer-postcss': transformerPostcss,
  '@parcel/transformer-posthtml': transformerPosthtml,
  '@parcel/transformer-raw': transformerRaw,
};

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
    opts: ?{|range?: SemverRange, autoinstall?: boolean, saveDev?: boolean|},
  ): Promise<any> {
    let {resolved} = await this.resolve(name, from, opts);
    return this.load(resolved, from);
  }

  requireSync(name: ModuleSpecifier, from: FilePath): any {
    let {resolved} = this.resolveSync(name, from);
    return this.load(resolved, from);
  }

  load(resolved: FilePath, from: FilePath): any {
    // $FlowFixMe
    if (resolved in BUILTINS) {
      return BUILTINS[resolved];
    }

    if (!path.isAbsolute(resolved)) {
      // $FlowFixMe
      if (process.browser) {
        throw new Error(`Cannot require '${resolved}' in the browser`);
      } else {
        // Node builtin module
        // $FlowFixMe
        return require(resolved);
      }
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
  ): Promise<ResolveResult> {
    let basedir = path.dirname(from);
    let key = basedir + ':' + name;
    let resolved = this.cache.get(key);
    if (!resolved) {
      try {
        resolved = await resolve(this.fs, name, {
          basedir,
          // $FlowFixMe
          extensions: process.browser
            ? ['.js', '.json']
            : Object.keys(Module._extensions),
        });
      } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND' || options?.autoinstall !== true) {
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

          if (conflicts == null && options?.autoinstall === true) {
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

  resolveSync(name: ModuleSpecifier, from: FilePath): ResolveResult {
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

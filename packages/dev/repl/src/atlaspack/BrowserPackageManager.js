// @flow
import type {
  FilePath,
  DependencySpecifier,
  SemverRange,
} from '@atlaspack/types';
import type {FileSystem} from '@atlaspack/fs';
import type {
  PackageManager,
  Invalidations,
  ResolveResult,
} from '@atlaspack/package-manager';
import {registerSerializableClass} from '@atlaspack/core';
// $FlowFixMe[untyped-import]
import packageJson from '../../package.json';

import path from 'path';
import nullthrows from 'nullthrows';
import {ResolverBase, init} from '@atlaspack/node-resolver-core';

import bundlerDefault from '@atlaspack/bundler-default';
import compressorRaw from '@atlaspack/compressor-raw';
import namerDefault from '@atlaspack/namer-default';
import optimizerCSS from '@atlaspack/optimizer-css';
import optimizerTerser from '@atlaspack/optimizer-terser';
import packagerCss from '@atlaspack/packager-css';
import packagerHtml from '@atlaspack/packager-html';
import packagerJs from '@atlaspack/packager-js';
import packagerRaw from '@atlaspack/packager-raw';
import reporterJson from '@atlaspack/reporter-json';
import reporterServer from '@atlaspack/reporter-dev-server-sw';
import resolverDefault from '@atlaspack/resolver-default';
import resolverREPLRuntimes from '@atlaspack/resolver-repl-runtimes';
import runtimeHMR from '@atlaspack/runtime-browser-hmr';
import runtimeJs from '@atlaspack/runtime-js';
import runtimeReactRefresh from '@atlaspack/runtime-react-refresh';
import transformerBabel from '@atlaspack/transformer-babel';
import transformerCss from '@atlaspack/transformer-css';
import transformerHtml from '@atlaspack/transformer-html';
import transformerInlineString from '@atlaspack/transformer-inline-string';
import transformerJs from '@atlaspack/transformer-js';
import transformerJson from '@atlaspack/transformer-json';
import transformerPostcss from '@atlaspack/transformer-postcss';
import transformerPosthtml from '@atlaspack/transformer-posthtml';
import transformerRaw from '@atlaspack/transformer-raw';
import transformerReactRefreshWrap from '@atlaspack/transformer-react-refresh-wrap';

export const BUILTINS = {
  '@atlaspack/bundler-default': bundlerDefault,
  '@atlaspack/compressor-raw': compressorRaw,
  '@atlaspack/namer-default': namerDefault,
  '@atlaspack/optimizer-css': optimizerCSS,
  '@atlaspack/optimizer-terser': optimizerTerser,
  '@atlaspack/packager-css': packagerCss,
  '@atlaspack/packager-html': packagerHtml,
  '@atlaspack/packager-js': packagerJs,
  '@atlaspack/packager-raw': packagerRaw,
  '@atlaspack/reporter-dev-server-sw': reporterServer,
  '@atlaspack/reporter-json': reporterJson,
  '@atlaspack/resolver-default': resolverDefault,
  '@atlaspack/resolver-repl-runtimes': resolverREPLRuntimes,
  '@atlaspack/runtime-browser-hmr': runtimeHMR,
  '@atlaspack/runtime-js': runtimeJs,
  '@atlaspack/runtime-react-refresh': runtimeReactRefresh,
  '@atlaspack/transformer-babel': transformerBabel,
  '@atlaspack/transformer-css': transformerCss,
  '@atlaspack/transformer-html': transformerHtml,
  '@atlaspack/transformer-inline-string': transformerInlineString,
  '@atlaspack/transformer-js': transformerJs,
  '@atlaspack/transformer-json': transformerJson,
  '@atlaspack/transformer-postcss': transformerPostcss,
  '@atlaspack/transformer-posthtml': transformerPosthtml,
  '@atlaspack/transformer-raw': transformerRaw,
  '@atlaspack/transformer-react-refresh-wrap': transformerReactRefreshWrap,
};

// Package.json fields. Must match package_json.rs.
const MAIN = 1 << 0;
const SOURCE = 1 << 2;
const ENTRIES =
  MAIN |
  (process.env.ATLASPACK_BUILD_ENV !== 'production' ||
  process.env.ATLASPACK_SELF_BUILD
    ? SOURCE
    : 0);

export class BrowserPackageManager implements PackageManager {
  resolver: ?ResolverBase;
  fs: FileSystem;
  projectRoot: FilePath;
  cache: Map<DependencySpecifier, ResolveResult> = new Map();

  constructor(fs: FileSystem, projectRoot: FilePath) {
    this.fs = fs;
    this.projectRoot = projectRoot;
  }

  async getResolver(): Promise<ResolverBase> {
    if (this.resolver != null) return this.resolver;
    await init?.();
    this.resolver = new ResolverBase(this.projectRoot, {
      fs: {
        canonicalize: path => this.fs.realpathSync(path),
        read: path => this.fs.readFileSync(path),
        isFile: path => this.fs.statSync(path).isFile(),
        isDir: path => this.fs.statSync(path).isDirectory(),
      },
      mode: 2,
      entries: ENTRIES,
      packageExports: true,
    });
    return this.resolver;
  }

  static deserialize(opts: any): BrowserPackageManager {
    return new BrowserPackageManager(opts.fs, opts.projectRoot);
  }

  serialize(): {|
    $$raw: boolean,
    fs: FileSystem,
    projectRoot: FilePath,
  |} {
    return {
      $$raw: false,
      fs: this.fs,
      projectRoot: this.projectRoot,
    };
  }

  async require(
    name: DependencySpecifier,
    from: FilePath,
    opts: ?{|
      range?: ?SemverRange,
      shouldAutoInstall?: boolean,
      saveDev?: boolean,
    |},
  ): Promise<any> {
    let {resolved} = await this.resolve(name, from, opts);

    // $FlowFixMe
    if (resolved in BUILTINS) {
      return BUILTINS[resolved];
    }

    throw new Error(`Cannot require '${resolved}' in the browser`);
  }

  async resolve(
    name: DependencySpecifier,
    from: FilePath,
    // eslint-disable-next-line no-unused-vars
    options?: ?{|
      range?: ?SemverRange,
      shouldAutoInstall?: boolean,
      saveDev?: boolean,
    |},
  ): Promise<ResolveResult> {
    if (name.startsWith('@atlaspack/')) {
      return Promise.resolve({
        resolved: name,
        pkg: {
          name: name,
          version: '2.0.0',
          engines: {
            atlaspack: '^2.0.0',
          },
        },
        invalidateOnFileChange: new Set(),
        invalidateOnFileCreate: [],
        type: 1,
      });
    }

    let basedir = path.dirname(from);
    let key = basedir + ':' + name;
    let resolved = this.cache.get(key);
    if (!resolved) {
      let res = (await this.getResolver()).resolve({
        filename: name,
        specifierType: 'commonjs',
        parent: from,
      });
      if (res.error) {
        let e = new Error(`Could not resolve module "${name}" from "${from}"`);
        // $FlowFixMe
        e.code = 'MODULE_NOT_FOUND';
        throw e;
      }
      let getPkg;
      switch (res.resolution.type) {
        case 'Path':
          getPkg = () => {
            let pkgPath = this.fs.findAncestorFile(
              ['package.json'],
              nullthrows(res.resolution.value),
              this.projectRoot,
            );
            resolved = pkgPath
              ? JSON.parse(this.fs.readFileSync(pkgPath, 'utf8'))
              : null;
          };
        // fallthrough
        case 'Builtin':
          resolved = {
            resolved: res.resolution.value,
            invalidateOnFileChange: new Set(res.invalidateOnFileChange),
            invalidateOnFileCreate: res.invalidateOnFileCreate,
            type: res.moduleType,
            get pkg() {
              return getPkg();
            },
          };
          break;
        default:
          throw new Error('Unknown resolution type');
      }
      this.cache.set(key, resolved);
    }
    return nullthrows(resolved);
  }

  getInvalidations(): Invalidations {
    return {
      invalidateOnFileCreate: [],
      invalidateOnFileChange: new Set(),
      invalidateOnStartup: false,
    };
  }
  invalidate(): void {}
}

registerSerializableClass(
  `${packageJson.version}:BrowserPackageManager`,
  BrowserPackageManager,
);

// @flow
import type {
  FilePath,
  PackageJSON,
  PackageName,
  ResolveResult,
} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

import invariant from 'assert';
import path from 'path';
import {
  isGlob,
  relativePath,
  normalizeSeparators,
  findAlternativeNodeModules,
  findAlternativeFiles,
} from '@parcel/utils';
import ThrowableDiagnostic, {
  generateJSONCodeHighlights,
} from '@parcel/diagnostic';
import micromatch from 'micromatch';
import builtins from './builtins';
import nullthrows from 'nullthrows';
// $FlowFixMe this is untyped
import _Module from 'module';

const EMPTY_SHIM = require.resolve('./_empty');

type InternalPackageJSON = PackageJSON & {pkgdir: string, pkgfile: string, ...};
type Options = {|
  fs: FileSystem,
  projectRoot: FilePath,
  extensions: Array<string>,
  mainFields: Array<string>,
|};
type ResolvedFile = {|
  path: string,
  pkg: InternalPackageJSON | null,
|};

type Env = {
  +includeNodeModules:
    | boolean
    | Array<PackageName>
    | {[PackageName]: boolean, ...},
  isBrowser(): boolean,
  isNode(): boolean,
  ...
};

type Aliases =
  | string
  | {[string]: string, ...}
  | {[string]: string | boolean, ...};
type Module = {|
  moduleName?: string,
  subPath?: ?string,
  moduleDir?: FilePath,
  filePath?: FilePath,
  code?: string,
|};

/**
 * This resolver implements a modified version of the node_modules resolution algorithm:
 * https://nodejs.org/api/modules.html#modules_all_together
 *
 * In addition to the standard algorithm, Parcel supports:
 *   - All file extensions supported by Parcel.
 *   - Glob file paths
 *   - Absolute paths (e.g. /foo) resolved relative to the project root.
 *   - Tilde paths (e.g. ~/foo) resolved relative to the nearest module root in node_modules.
 *   - The package.json module, jsnext:main, and browser field as replacements for package.main.
 *   - The package.json browser and alias fields as an alias map within a local module.
 *   - The package.json alias field in the root package for global aliases across all modules.
 */
export default class NodeResolver {
  fs: FileSystem;
  projectRoot: FilePath;
  extensions: Array<string>;
  mainFields: Array<string>;
  packageCache: Map<string, InternalPackageJSON>;
  rootPackage: InternalPackageJSON | null;

  constructor(opts: Options) {
    this.extensions = opts.extensions.map(ext =>
      ext.startsWith('.') ? ext : '.' + ext,
    );
    this.mainFields = opts.mainFields;
    this.fs = opts.fs;
    this.projectRoot = opts.projectRoot;
    this.packageCache = new Map();
    this.rootPackage = null;
  }

  async resolve({
    filename,
    parent,
    isURL,
    env,
  }: {|
    filename: FilePath,
    parent: ?FilePath,
    isURL: boolean,
    env: Env,
  |}): Promise<?ResolveResult> {
    // Get file extensions to search
    let extensions = this.extensions.slice();

    if (parent) {
      // parent's extension given high priority
      let parentExt = path.extname(parent);
      extensions = [parentExt, ...extensions.filter(ext => ext !== parentExt)];
    }

    extensions.unshift('');

    try {
      // Resolve the module directory or local file path
      let module = await this.resolveModule({
        filename,
        parent,
        isURL,
        env,
      });

      if (!module) {
        return {
          isExcluded: true,
        };
      }

      let resolved;
      if (module.moduleDir) {
        resolved = await this.loadNodeModules(module, extensions, env);
      } else if (module.filePath) {
        if (module.code != null) {
          return {
            filePath: await this.fs.realpath(module.filePath),
            code: module.code,
          };
        }

        resolved = await this.loadRelative(
          module.filePath,
          extensions,
          env,
          parent ? path.dirname(parent) : this.projectRoot,
        );
      }

      if (resolved) {
        return {
          filePath: await this.fs.realpath(resolved.path),
          sideEffects:
            resolved.pkg && !this.hasSideEffects(resolved.path, resolved.pkg)
              ? false
              : undefined,
        };
      }
    } catch (err) {
      if (err instanceof ThrowableDiagnostic) {
        return {
          diagnostics: err.diagnostics,
        };
      } else {
        throw err;
      }
    }

    return null;
  }

  async resolveModule({
    filename,
    parent,
    isURL,
    env,
  }: {|
    filename: string,
    parent: ?FilePath,
    isURL: boolean,
    env: Env,
  |}): Promise<?Module> {
    let dir = parent ? path.dirname(parent) : this.fs.cwd();

    // If this isn't the entrypoint, resolve the input file to an absolute path
    if (parent) {
      filename = await this.resolveFilename(filename, dir, isURL);
    }

    // Resolve aliases in the parent module for this file.
    let alias = await this.loadAlias(filename, dir, env);
    if (Array.isArray(alias)) {
      if (alias[0] === 'global') {
        return {
          filePath: path.join(this.projectRoot, `${alias[1]}.js`),
          code: `module.exports=${alias[1]};`,
        };
      }
      filename = alias[1];
    } else if (typeof alias === 'string') {
      filename = alias;
    }

    // Return just the file path if this is a file, not in node_modules
    if (path.isAbsolute(filename)) {
      return {
        filePath: filename,
      };
    }

    if (!this.shouldIncludeNodeModule(env, filename)) {
      return null;
    }

    let builtin = this.findBuiltin(filename, env);
    if (builtin || builtin === null) {
      return builtin;
    }

    // Resolve the module in node_modules
    let resolved;
    try {
      resolved = this.findNodeModulePath(filename, dir);
    } catch (err) {
      // ignore
    }

    if (resolved === undefined && process.versions.pnp != null && parent) {
      try {
        let [moduleName, subPath] = this.getModuleParts(filename);
        let pnp = _Module.findPnpApi(path.dirname(parent));

        let res = pnp.resolveToUnqualified(
          moduleName +
            // retain slash in `require('assert/')` to force loading builtin from npm
            (filename[moduleName.length] === '/' ? '/' : ''),
          parent,
        );

        resolved = {
          moduleName,
          subPath,
          moduleDir: res,
          filePath: path.join(res, subPath || ''),
        };
      } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
          return null;
        }
      }
    }

    // If we couldn't resolve the node_modules path, just return the module name info
    if (resolved === undefined) {
      let [moduleName, subPath] = this.getModuleParts(filename);
      resolved = {
        moduleName,
        subPath,
      };

      let alternativeModules = await findAlternativeNodeModules(
        this.fs,
        resolved.moduleName,
        dir,
      );

      if (alternativeModules.length) {
        throw new ThrowableDiagnostic({
          diagnostic: {
            message: `Cannot find module ${resolved.moduleName}`,
            hints: alternativeModules.map(r => {
              return `Did you mean __${r}__?`;
            }),
          },
        });
      }
    }

    return resolved;
  }

  shouldIncludeNodeModule({includeNodeModules}: Env, name: string): boolean {
    if (includeNodeModules === false) {
      return false;
    }

    if (Array.isArray(includeNodeModules)) {
      let [moduleName] = this.getModuleParts(name);
      return includeNodeModules.includes(moduleName);
    }

    if (includeNodeModules && typeof includeNodeModules === 'object') {
      let [moduleName] = this.getModuleParts(name);
      let include = includeNodeModules[moduleName];
      if (include != null) {
        return !!include;
      }
    }

    return true;
  }

  async resolveFilename(
    filename: string,
    dir: string,
    isURL: ?boolean,
  ): Promise<string> {
    switch (filename[0]) {
      case '/': {
        // Absolute path. Resolve relative to project root.
        return path.resolve(this.projectRoot, filename.slice(1));
      }

      case '~': {
        // Tilde path. Resolve relative to nearest node_modules directory,
        // the nearest directory with package.json or the project root - whichever comes first.
        const insideNodeModules = dir.includes('node_modules');

        while (
          dir !== this.projectRoot &&
          path.basename(path.dirname(dir)) !== 'node_modules' &&
          (insideNodeModules ||
            !(await this.fs.exists(path.join(dir, 'package.json'))))
        ) {
          dir = path.dirname(dir);

          if (dir === path.dirname(dir)) {
            dir = this.projectRoot;
            break;
          }
        }

        return path.join(dir, filename.slice(1));
      }

      case '.': {
        // Relative path.
        return path.resolve(dir, filename);
      }

      default: {
        if (isURL) {
          return path.resolve(dir, filename);
        }

        // Module
        return filename;
      }
    }
  }

  async loadRelative(
    filename: string,
    extensions: Array<string>,
    env: Env,
    parentdir: string,
  ): Promise<?ResolvedFile> {
    // Find a package.json file in the current package.
    let pkg = await this.findPackage(path.dirname(filename));

    // First try as a file, then as a directory.
    let resolvedFile =
      (await this.loadAsFile({
        file: filename,
        extensions,
        env,
        pkg,
      })) ||
      (await this.loadDirectory({
        dir: filename,
        extensions,
        env,
        pkg,
      }));

    if (!resolvedFile) {
      // If we can't load the file do a fuzzySearch for potential hints
      let relativeFileSpecifier = relativePath(parentdir, filename);
      let potentialFiles = await findAlternativeFiles(
        this.fs,
        relativeFileSpecifier,
        parentdir,
      );

      throw new ThrowableDiagnostic({
        diagnostic: {
          message: `Cannot load file '${relativeFileSpecifier}' in '${relativePath(
            this.projectRoot,
            parentdir,
          )}'.`,
          hints: potentialFiles.map(r => {
            return `Did you mean __${r}__?`;
          }),
        },
      });
    }

    return resolvedFile;
  }

  findBuiltin(filename: string, env: Env): ?Module {
    if (builtins[filename]) {
      if (env.isNode()) {
        return null;
      }

      return {filePath: builtins[filename]};
    }
  }

  findNodeModulePath(filename: string, dir: string): ?Module {
    let [moduleName, subPath] = this.getModuleParts(filename);
    let moduleDir = this.fs.findNodeModule(moduleName, dir);
    if (moduleDir) {
      return {
        moduleName,
        subPath,
        moduleDir,
        filePath: subPath ? path.join(moduleDir, subPath) : moduleDir,
      };
    }

    return undefined;
  }

  async loadNodeModules(
    module: Module,
    extensions: Array<string>,
    env: Env,
  ): Promise<?ResolvedFile> {
    // If a module was specified as a module sub-path (e.g. some-module/some/path),
    // it is likely a file. Try loading it as a file first.
    if (module.subPath && module.moduleDir) {
      let pkg = await this.readPackage(module.moduleDir);
      let res = await this.loadAsFile({
        file: nullthrows(module.filePath),
        extensions,
        env,
        pkg,
      });
      if (res) {
        return res;
      }
    }

    // Otherwise, load as a directory.
    return this.loadDirectory({
      dir: nullthrows(module.filePath),
      extensions,
      env,
    });
  }

  async loadDirectory({
    dir,
    extensions,
    env,
    pkg,
  }: {|
    dir: string,
    extensions: Array<string>,
    env: Env,
    pkg?: InternalPackageJSON | null,
  |}): Promise<?ResolvedFile> {
    let failedEntry;
    try {
      pkg = await this.readPackage(dir);

      if (pkg) {
        // Get a list of possible package entry points.
        let entries = this.getPackageEntries(pkg, env);

        for (let entry of entries) {
          // First try loading package.main as a file, then try as a directory.
          let res =
            (await this.loadAsFile({
              file: entry.filename,
              extensions,
              env,
              pkg,
            })) ||
            (await this.loadDirectory({
              dir: entry.filename,
              extensions,
              env,
              pkg,
            }));

          if (res) {
            return res;
          } else {
            failedEntry = entry;
            throw new Error('');
          }
        }
      }
    } catch (e) {
      if (failedEntry && pkg) {
        // If loading the entry failed, try to load an index file, and fall back
        // to it if it exists.
        let indexFallback = await this.loadAsFile({
          file: path.join(dir, 'index'),
          extensions,
          env,
          pkg,
        });
        if (indexFallback != null) {
          return indexFallback;
        }

        let fileSpecifier = relativePath(dir, failedEntry.filename);
        let alternatives = await findAlternativeFiles(
          this.fs,
          fileSpecifier,
          pkg.pkgdir,
        );

        let alternative = alternatives[0];
        let pkgContent = await this.fs.readFile(pkg.pkgfile, 'utf8');
        throw new ThrowableDiagnostic({
          diagnostic: {
            message: `Could not load '${fileSpecifier}' from module '${pkg.name}' found in package.json#${failedEntry.field}`,
            language: 'json',
            filePath: pkg.pkgfile,
            codeFrame: {
              code: pkgContent,
              codeHighlights: generateJSONCodeHighlights(pkgContent, [
                {
                  key: `/${failedEntry.field}`,
                  type: 'value',
                  message: `'${fileSpecifier}' does not exist${
                    alternative ? `, did you mean '${alternative}'?` : ''
                  }'`,
                },
              ]),
            },
          },
        });
      }
    }

    // Fall back to an index file inside the directory.
    return this.loadAsFile({
      file: path.join(dir, 'index'),
      extensions,
      env,
      pkg: pkg || null,
    });
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

    // If the package has a `source` field, check if it is behind a symlink.
    // If so, we treat the module as source code rather than a pre-compiled module.
    if (pkg.source) {
      let realpath = await this.fs.realpath(file);
      if (realpath === file) {
        delete pkg.source;
      }
    }

    this.packageCache.set(file, pkg);
    return pkg;
  }

  getPackageEntries(
    pkg: InternalPackageJSON,
    env: Env,
  ): Array<{|
    filename: string,
    field: string,
  |}> {
    return this.mainFields
      .map(field => {
        if (field === 'browser' && pkg.browser != null) {
          if (!env.isBrowser()) {
            return null;
          } else if (typeof pkg.browser === 'string') {
            return {field, filename: pkg.browser};
          } else if (typeof pkg.browser === 'object' && pkg.browser[pkg.name]) {
            return {
              field: `browser/${pkg.name}`,
              filename: pkg.browser[pkg.name],
            };
          }
        }

        return {
          field,
          filename: pkg[field],
        };
      })
      .filter(
        entry => entry && entry.filename && typeof entry.filename === 'string',
      )
      .map(entry => {
        invariant(entry != null && typeof entry.filename === 'string');

        // Current dir refers to an index file
        if (entry.filename === '.' || entry.filename === './') {
          entry.filename = 'index';
        }

        return {
          field: entry.field,
          filename: path.resolve(pkg.pkgdir, entry.filename),
        };
      });
  }

  async loadAsFile({
    file,
    extensions,
    env,
    pkg,
  }: {|
    file: string,
    extensions: Array<string>,
    env: Env,
    pkg: InternalPackageJSON | null,
  |}): Promise<?ResolvedFile> {
    // Try all supported extensions
    let files = await this.expandFile(file, extensions, env, pkg);
    let found = this.fs.findFirstFile(files);
    if (found) {
      return {path: found, pkg};
    }

    return null;
  }

  async expandFile(
    file: string,
    extensions: Array<string>,
    env: Env,
    pkg: InternalPackageJSON | null,
    expandAliases?: boolean = true,
  ): Promise<Array<string>> {
    // Expand extensions and aliases
    let res = [];
    for (let ext of extensions) {
      let f = file + ext;

      if (expandAliases) {
        let alias = await this.resolveAliases(f, env, pkg);
        if (Array.isArray(alias)) {
          if (alias[0] === 'global') {
            alias = f;
          } else {
            alias = alias[1];
          }
        }
        if (alias !== f) {
          res = res.concat(
            await this.expandFile(alias, extensions, env, pkg, false),
          );
        }
      }

      res.push(f);
    }

    return res;
  }

  async resolveAliases(
    filename: string,
    env: Env,
    pkg: InternalPackageJSON | null,
  ): Promise<string | Array<string>> {
    let localAliases = await this.resolvePackageAliases(filename, env, pkg);
    if (Array.isArray(localAliases) || typeof localAliases === 'boolean') {
      return localAliases;
    }

    // First resolve local package aliases, then project global ones.
    return this.resolvePackageAliases(filename, env, this.rootPackage);
  }

  async resolvePackageAliases(
    filename: string,
    env: Env,
    pkg: InternalPackageJSON | null,
  ): Promise<string | Array<string>> {
    if (!pkg) {
      return filename;
    }

    let pkgKeys = ['source', 'alias'];
    if (env.isBrowser()) pkgKeys.push('browser');

    for (let pkgKey of pkgKeys) {
      let alias = await this.getAlias(filename, pkg.pkgdir, pkg[pkgKey]);
      if (alias != null) return alias;
    }
    return filename;
  }

  async getAlias(
    filename: FilePath,
    dir: FilePath,
    aliases: ?Aliases,
  ): Promise<null | Array<string>> {
    if (!filename || !aliases || typeof aliases !== 'object') {
      return null;
    }

    let alias;

    // If filename is an absolute path, get one relative to the package.json directory.
    if (path.isAbsolute(filename)) {
      filename = relativePath(dir, filename);
      alias = this.lookupAlias(aliases, filename);
    } else {
      // It is a node_module. First try the entire filename as a key.
      alias = this.lookupAlias(aliases, normalizeSeparators(filename));
      if (alias == null) {
        // If it didn't match, try only the module name.
        let [moduleName, subPath] = this.getModuleParts(filename);
        alias = this.lookupAlias(aliases, moduleName);
        if (typeof alias === 'string' && subPath) {
          let isRelative = alias.startsWith('./');
          // Append the filename back onto the aliased module.
          alias = path.posix.join(alias, subPath);
          // because of path.join('./nested', 'sub') === 'nested/sub'
          if (isRelative) alias = './' + alias;
        }
      }
    }

    // If the alias is set to `false`, return an empty file.
    if (alias === false) {
      return ['file', EMPTY_SHIM];
    }

    if (alias instanceof Object) {
      if (alias.global) {
        if (typeof alias.global !== 'string' || alias.global.length === 0) {
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: `The global alias for ${filename} is invalid.`,
              hints: [`Only nonzero-length strings are valid global aliases.`],
            },
          });
        }
        return ['global', alias.global];
      } else if (alias.fileName) {
        alias = alias.fileName;
      }
    }

    if (typeof alias === 'string') {
      // Assume file
      return ['file', await this.resolveFilename(alias, dir)];
    }

    return null;
  }

  lookupAlias(aliases: Aliases, filename: FilePath): null | boolean | string {
    if (typeof aliases !== 'object') {
      return null;
    }

    // First, try looking up the exact filename
    let alias = aliases[filename];
    if (alias == null) {
      // Otherwise, try replacing glob keys
      for (let key in aliases) {
        let val = aliases[key];
        if (typeof val === 'string' && isGlob(key)) {
          let re = micromatch.makeRe(key, {capture: true});
          if (re.test(filename)) {
            alias = filename.replace(re, val);
            break;
          }
        }
      }
    }
    return alias;
  }

  findPackage(dir: string): Promise<InternalPackageJSON | null> {
    // Find the nearest package.json file within the current node_modules folder
    let pkgFile = this.fs.findAncestorFile(['package.json'], dir);
    if (pkgFile) {
      return this.readPackage(path.dirname(pkgFile));
    }

    return Promise.resolve(null);
  }

  async loadAlias(
    filename: string,
    dir: string,
    env: Env,
  ): Promise<string | Array<string>> {
    // Load the root project's package.json file if we haven't already
    if (!this.rootPackage) {
      this.rootPackage = await this.findPackage(this.projectRoot);
    }

    // Load the local package, and resolve aliases
    let pkg = await this.findPackage(dir);
    return this.resolveAliases(filename, env, pkg);
  }

  getModuleParts(name: string): [FilePath, ?string] {
    name = path.normalize(name);
    let splitOn = name.indexOf(path.sep);
    if (name.charAt(0) === '@') {
      splitOn = name.indexOf(path.sep, splitOn + 1);
    }
    if (splitOn < 0) {
      return [normalizeSeparators(name), undefined];
    } else {
      return [
        normalizeSeparators(name.substring(0, splitOn)),
        name.substring(splitOn + 1) || undefined,
      ];
    }
  }

  hasSideEffects(filePath: FilePath, pkg: InternalPackageJSON): boolean {
    switch (typeof pkg.sideEffects) {
      case 'boolean':
        return pkg.sideEffects;
      case 'string': {
        let sideEffects = pkg.sideEffects;
        invariant(typeof sideEffects === 'string');
        return micromatch.isMatch(
          path.relative(pkg.pkgdir, filePath),
          sideEffects,
          {matchBase: true},
        );
      }
      case 'object':
        return pkg.sideEffects.some(sideEffects =>
          this.hasSideEffects(filePath, {...pkg, sideEffects}),
        );
    }

    return true;
  }
}

// @flow
import type {
  PluginOptions,
  PackageJSON,
  FilePath,
  ResolveResult,
  Environment,
} from '@parcel/types';
import path from 'path';
import {isGlob, fuzzySearch} from '@parcel/utils';
import ThrowableDiagnostic from '@parcel/diagnostic';
import micromatch from 'micromatch';
import builtins from './builtins';
import nullthrows from 'nullthrows';

const EMPTY_SHIM = require.resolve('./_empty');

type InternalPackageJSON = PackageJSON & {pkgdir: string, ...};
type Options = {|
  options: PluginOptions,
  extensions: Array<string>,
  mainFields: Array<string>,
|};

type Aliases =
  | string
  | {[string]: string, ...}
  | {[string]: string | boolean, ...};
type Module = {|
  moduleName?: string,
  subPath?: string,
  moduleDir?: FilePath,
  filePath?: FilePath,
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
  options: PluginOptions;
  extensions: Array<string>;
  mainFields: Array<string>;
  packageCache: Map<string, InternalPackageJSON>;
  rootPackage: InternalPackageJSON | null;

  constructor(opts: Options) {
    this.extensions = opts.extensions.map(ext =>
      ext.startsWith('.') ? ext : '.' + ext,
    );
    this.mainFields = opts.mainFields;
    this.options = opts.options;
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
    env: Environment,
  |}): Promise<?ResolveResult> {
    // Get file extensions to search
    let extensions = this.extensions.slice();

    if (parent) {
      // parent's extension given high priority
      let parentExt = path.extname(parent);
      extensions = [parentExt, ...extensions.filter(ext => ext !== parentExt)];
    }

    extensions.unshift('');

    // Resolve the module directory or local file path
    let module = await this.resolveModule({filename, parent, isURL, env});
    if (!module) {
      return {isExcluded: true};
    }

    let resolved;
    if (module.moduleDir) {
      resolved = await this.loadNodeModules(module, extensions, env);
    } else if (module.filePath) {
      resolved = await this.loadRelative(module.filePath, extensions, env);
    }

    if (resolved) {
      let result: ResolveResult = {
        filePath: resolved.path,
      };

      if (resolved.pkg && !this.hasSideEffects(resolved.path, resolved.pkg)) {
        result.sideEffects = false;
      }

      return result;
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
    env: Environment,
  |}): Promise<?Module> {
    let dir = parent ? path.dirname(parent) : this.options.inputFS.cwd();

    // If this isn't the entrypoint, resolve the input file to an absolute path
    if (parent) {
      filename = await this.resolveFilename(filename, dir, isURL);
    }

    // Resolve aliases in the parent module for this file.
    filename = await this.loadAlias(filename, dir, env);

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
      resolved = await this.findNodeModulePath(filename, dir);
    } catch (err) {
      // ignore
    }

    // If we couldn't resolve the node_modules path, just return the module name info
    if (resolved === undefined) {
      let parts = this.getModuleParts(filename);
      resolved = {
        moduleName: parts[0],
        subPath: parts[1],
      };
    }

    return resolved;
  }

  shouldIncludeNodeModule({includeNodeModules}: Environment, name: string) {
    if (includeNodeModules === false) {
      return false;
    }

    if (Array.isArray(includeNodeModules)) {
      let parts = this.getModuleParts(name);
      return includeNodeModules.includes(parts[0]);
    }

    if (includeNodeModules && typeof includeNodeModules === 'object') {
      let parts = this.getModuleParts(name);
      let include = includeNodeModules[parts[0]];
      if (include != null) {
        return !!include;
      }
    }

    return true;
  }

  async resolveFilename(filename: string, dir: string, isURL: ?boolean) {
    switch (filename[0]) {
      case '/': {
        // Absolute path. Resolve relative to project root.
        return path.resolve(this.options.rootDir, filename.slice(1));
      }

      case '~': {
        // Tilde path. Resolve relative to nearest node_modules directory,
        // the nearest directory with package.json or the project root - whichever comes first.
        const insideNodeModules = dir.includes('node_modules');

        while (
          dir !== this.options.projectRoot &&
          path.basename(path.dirname(dir)) !== 'node_modules' &&
          (insideNodeModules ||
            !(await this.options.inputFS.exists(
              path.join(dir, 'package.json'),
            )))
        ) {
          dir = path.dirname(dir);

          if (dir === path.dirname(dir)) {
            dir = this.options.rootDir;
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
    env: Environment,
  ) {
    // Find a package.json file in the current package.
    let pkg = await this.findPackage(path.dirname(filename));

    // First try as a file, then as a directory.
    let resolvedFile = await this.loadAsFile({
      file: filename,
      extensions,
      env,
      pkg,
    });

    if (!resolvedFile) {
      let resolvedDir = await this.loadDirectory({
        dir: filename,
        extensions,
        env,
        pkg,
      });

      if (resolvedDir) {
        return resolvedDir;
      }

      // If we can't load the file do a fuzzySearch for potential hints
      let dir = path.dirname(filename);
      let basename = path.basename(filename);
      let dirContent = await this.options.inputFS.readdir(dir);
      let closest = fuzzySearch(dirContent, basename);
      if (closest.length) {
        throw new ThrowableDiagnostic({
          diagnostic: {
            message: `Cannot load file __${basename}__ in ${dir}`,
            hints: closest.map(r => {
              return `Did you mean __${r}__?`;
            }),
          },
        });
      }
    }

    return resolvedFile;
  }

  findBuiltin(filename: string, env: Environment) {
    if (builtins[filename]) {
      if (env.isNode()) {
        return null;
      }

      return {filePath: builtins[filename]};
    }
  }

  async findNodeModulePath(filename: string, dir: string) {
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
        let stats = await this.options.inputFS.stat(moduleDir);
        if (stats.isDirectory()) {
          return {
            moduleName: parts[0],
            subPath: parts[1],
            moduleDir: moduleDir,
            filePath: path.join(dir, 'node_modules', filename),
          };
        }
      } catch (err) {
        // ignore
      }

      // Move up a directory
      dir = path.dirname(dir);
    }

    return undefined;
  }

  async loadNodeModules(
    module: Module,
    extensions: Array<string>,
    env: Environment,
  ) {
    try {
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
      return await this.loadDirectory({
        dir: nullthrows(module.filePath),
        extensions,
        env,
      });
    } catch (e) {
      // ignore
    }
  }

  async isFile(file: FilePath) {
    try {
      let stat = await this.options.inputFS.stat(file);
      return stat.isFile() || stat.isFIFO();
    } catch (err) {
      return false;
    }
  }

  async loadDirectory({
    dir,
    extensions,
    env,
    pkg,
  }: {|
    dir: string,
    extensions: Array<string>,
    env: Environment,
    pkg?: InternalPackageJSON | null,
  |}) {
    try {
      pkg = await this.readPackage(dir);

      // Get a list of possible package entry points.
      let entries = this.getPackageEntries(pkg, env);

      for (let file of entries) {
        // First try loading package.main as a file, then try as a directory.
        const res =
          (await this.loadAsFile({file, extensions, env, pkg})) ||
          (await this.loadDirectory({dir: file, extensions, env, pkg}));
        if (res) {
          return res;
        }
      }
    } catch (err) {
      // ignore
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

    let json = await this.options.inputFS.readFile(file, 'utf8');
    let pkg = JSON.parse(json);

    pkg.pkgfile = file;
    pkg.pkgdir = dir;

    // If the package has a `source` field, check if it is behind a symlink.
    // If so, we treat the module as source code rather than a pre-compiled module.
    if (pkg.source) {
      let realpath = await this.options.inputFS.realpath(file);
      if (realpath === file) {
        delete pkg.source;
      }
    }

    this.packageCache.set(file, pkg);
    return pkg;
  }

  getPackageEntries(pkg: InternalPackageJSON, env: Environment): Array<string> {
    return this.mainFields
      .map(field => {
        if (field === 'browser' && pkg.browser != null) {
          if (!env.isBrowser()) {
            return null;
          } else if (typeof pkg.browser === 'string') {
            return pkg.browser;
          } else if (typeof pkg.browser === 'object' && pkg.browser[pkg.name]) {
            return pkg.browser[pkg.name];
          }
        }

        return pkg[field];
      })
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

  async loadAsFile({
    file,
    extensions,
    env,
    pkg,
  }: {|
    file: string,
    extensions: Array<string>,
    env: Environment,
    pkg: InternalPackageJSON | null,
  |}) {
    // Try all supported extensions
    for (let f of await this.expandFile(file, extensions, env, pkg)) {
      if (await this.isFile(f)) {
        return {path: f, pkg};
      }
    }
  }

  async expandFile(
    file: string,
    extensions: Array<string>,
    env: Environment,
    pkg: InternalPackageJSON | null,
    expandAliases?: boolean = true,
  ): Promise<Array<string>> {
    // Expand extensions and aliases
    let res = [];
    for (let ext of extensions) {
      let f = file + ext;

      if (expandAliases) {
        let alias = await this.resolveAliases(file + ext, env, pkg);
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
    env: Environment,
    pkg: InternalPackageJSON | null,
  ) {
    // First resolve local package aliases, then project global ones.
    return this.resolvePackageAliases(
      await this.resolvePackageAliases(filename, env, pkg),
      env,
      this.rootPackage,
    );
  }

  async resolvePackageAliases(
    filename: string,
    env: Environment,
    pkg: InternalPackageJSON | null,
  ) {
    if (!pkg) {
      return filename;
    }

    // Resolve aliases in the package.source, package.alias, and package.browser fields.
    return (
      (await this.getAlias(filename, pkg.pkgdir, pkg.source)) ||
      (await this.getAlias(filename, pkg.pkgdir, pkg.alias)) ||
      (env.isBrowser() &&
        (await this.getAlias(filename, pkg.pkgdir, pkg.browser))) ||
      filename
    );
  }

  async getAlias(filename: FilePath, dir: FilePath, aliases: ?Aliases) {
    if (!filename || !aliases || typeof aliases !== 'object') {
      return null;
    }

    let alias;

    // If filename is an absolute path, get one relative to the package.json directory.
    if (path.isAbsolute(filename)) {
      filename = path.relative(dir, filename);
      if (filename[0] !== '.') {
        filename = './' + filename;
      }

      alias = await this.lookupAlias(aliases, filename, dir);
    } else {
      // It is a node_module. First try the entire filename as a key.
      alias = await this.lookupAlias(aliases, filename, dir);
      if (alias == null) {
        // If it didn't match, try only the module name.
        let parts = this.getModuleParts(filename);
        alias = await this.lookupAlias(aliases, parts[0], dir);
        if (typeof alias === 'string') {
          // Append the filename back onto the aliased module.
          alias = path.join(alias, ...parts.slice(1));
        }
      }
    }

    // If the alias is set to `false`, return an empty file.
    if (alias === false) {
      return EMPTY_SHIM;
    }

    return alias;
  }

  lookupAlias(aliases: Aliases, filename: FilePath, dir: FilePath) {
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

    if (typeof alias === 'string') {
      return this.resolveFilename(alias, dir);
    } else if (alias === false) {
      return false;
    }

    return null;
  }

  async findPackage(dir: string) {
    // Find the nearest package.json file within the current node_modules folder
    let root = path.parse(dir).root;
    while (dir !== root && path.basename(dir) !== 'node_modules') {
      try {
        return await this.readPackage(dir);
      } catch (err) {
        // ignore
      }

      dir = path.dirname(dir);
    }

    return null;
  }

  async loadAlias(filename: string, dir: string, env: Environment) {
    // Load the root project's package.json file if we haven't already
    if (!this.rootPackage) {
      this.rootPackage = await this.findPackage(this.options.rootDir);
    }

    // Load the local package, and resolve aliases
    let pkg = await this.findPackage(dir);
    return this.resolveAliases(filename, env, pkg);
  }

  getModuleParts(name: string) {
    let parts = path.normalize(name).split(path.sep);
    if (parts[0].charAt(0) === '@') {
      // Scoped module (e.g. @scope/module). Merge the first two parts back together.
      parts.splice(0, 2, `${parts[0]}/${parts[1]}`);
    }

    return parts;
  }

  hasSideEffects(filePath: FilePath, pkg: InternalPackageJSON) {
    switch (typeof pkg.sideEffects) {
      case 'boolean':
        return pkg.sideEffects;
      case 'string':
        return micromatch.isMatch(
          path.relative(pkg.pkgdir, filePath),
          pkg.sideEffects,
          {matchBase: true},
        );
      case 'object':
        return pkg.sideEffects.some(sideEffects =>
          this.hasSideEffects(filePath, {...pkg, sideEffects}),
        );
    }

    return true;
  }
}

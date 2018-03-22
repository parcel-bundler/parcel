const builtins = require('./builtins');
const path = require('path');
const glob = require('glob');
const fs = require('./utils/fs');

const EMPTY_SHIM = require.resolve('./builtins/_empty');

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
class Resolver {
  constructor(options = {}) {
    this.options = options;
    this.cache = new Map();
    this.packageCache = new Map();
    this.rootPackage = null;
  }

  async resolve(input, parent) {
    let filename = input;

    // Check the cache first
    let key = this.getCacheKey(filename, parent);
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    // Check if this is a glob
    if (/[*+{}]/.test(filename) && glob.hasMagic(filename)) {
      return {path: path.resolve(path.dirname(parent), filename)};
    }

    // Get file extensions to search
    let extensions = Array.isArray(this.options.extensions)
      ? this.options.extensions.slice()
      : Object.keys(this.options.extensions);

    if (parent) {
      // parent's extension given high priority
      const parentExt = path.extname(parent);
      extensions = [parentExt, ...extensions.filter(ext => ext !== parentExt)];
    }

    extensions.unshift('');

    let dir = parent ? path.dirname(parent) : process.cwd();

    // If this isn't the entrypoint, resolve the input file to an absolute path
    if (parent) {
      filename = this.resolveFilename(filename, dir);
    }

    // Resolve aliases in the parent module for this file.
    filename = await this.loadAlias(filename, dir);

    let resolved;
    if (path.isAbsolute(filename)) {
      // load as file
      resolved = await this.loadRelative(filename, extensions);
    } else {
      // load node_modules
      resolved = await this.loadNodeModules(filename, dir, extensions);
    }

    if (!resolved) {
      let err = new Error(
        "Cannot find module '" + input + "' from '" + dir + "'"
      );
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }

    this.cache.set(key, resolved);
    return resolved;
  }

  getCacheKey(filename, parent) {
    return (parent ? path.dirname(parent) : '') + ':' + filename;
  }

  resolveFilename(filename, dir) {
    switch (filename[0]) {
      case '/':
        // Absolute path. Resolve relative to project root.
        return path.resolve(this.options.rootDir, filename.slice(1));

      case '~':
        // Tilde path. Resolve relative to nearest node_modules directory,
        // or the project root - whichever comes first.
        while (
          dir !== this.options.rootDir &&
          path.basename(path.dirname(dir)) !== 'node_modules'
        ) {
          dir = path.dirname(dir);
        }

        return path.join(dir, filename.slice(1));

      case '.':
        // Relative path.
        return path.resolve(dir, filename);

      default:
        // Module
        return path.normalize(filename);
    }
  }

  async loadRelative(filename, extensions) {
    // Find a package.json file in the current package.
    let pkg = await this.findPackage(path.dirname(filename));

    // First try as a file, then as a directory.
    return (
      (await this.loadAsFile(filename, extensions, pkg)) ||
      (await this.loadDirectory(filename, extensions, pkg))
    );
  }

  async loadNodeModules(filename, dir, extensions) {
    // Check if this is a builtin module
    if (builtins[filename]) {
      return {path: builtins[filename]};
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
        let stats = await fs.stat(moduleDir);
        if (stats.isDirectory()) {
          let f = path.join(dir, 'node_modules', filename);

          // If a module was specified as a module sub-path (e.g. some-module/some/path),
          // it is likely a file. Try loading it as a file first.
          if (parts.length > 1) {
            let pkg = await this.readPackage(moduleDir);
            let res = await this.loadAsFile(f, extensions, pkg);
            if (res) {
              return res;
            }
          }

          // Otherwise, load as a directory.
          return await this.loadDirectory(f, extensions);
        }
      } catch (err) {
        // ignore
      }

      // Move up a directory
      dir = path.dirname(dir);
    }
  }

  async isFile(file) {
    try {
      let stat = await fs.stat(file);
      return stat.isFile() || stat.isFIFO();
    } catch (err) {
      return false;
    }
  }

  async loadDirectory(dir, extensions, pkg) {
    try {
      pkg = await this.readPackage(dir);

      // First try loading package.main as a file, then try as a directory.
      let main = this.getPackageMain(pkg);
      let res =
        (await this.loadAsFile(main, extensions, pkg)) ||
        (await this.loadDirectory(main, extensions, pkg));

      if (res) {
        return res;
      }
    } catch (err) {
      // ignore
    }

    // Fall back to an index file inside the directory.
    return await this.loadAsFile(path.join(dir, 'index'), extensions, pkg);
  }

  async readPackage(dir) {
    let file = path.join(dir, 'package.json');
    if (this.packageCache.has(file)) {
      return this.packageCache.get(file);
    }

    let json = await fs.readFile(file, 'utf8');
    let pkg = JSON.parse(json);

    pkg.pkgfile = file;
    pkg.pkgdir = dir;

    this.packageCache.set(file, pkg);
    return pkg;
  }

  getPackageMain(pkg) {
    // libraries like d3.js specifies node.js specific files in the "main" which breaks the build
    // we use the "module" or "jsnext:main" field to get the full dependency tree if available
    let main = [pkg.module, pkg['jsnext:main'], pkg.browser, pkg.main].find(
      entry => typeof entry === 'string'
    );

    // Default to index file if no main field find
    if (!main || main === '.' || main === './') {
      main = 'index';
    }

    return path.resolve(pkg.pkgdir, main);
  }

  async loadAsFile(file, extensions, pkg) {
    // Try all supported extensions
    for (let f of this.expandFile(file, extensions, pkg)) {
      if (await this.isFile(f)) {
        return {path: f, pkg};
      }
    }
  }

  expandFile(file, extensions, pkg, expandAliases = true) {
    // Expand extensions and aliases
    let res = [];
    for (let ext of extensions) {
      let f = file + ext;

      if (expandAliases) {
        let alias = this.resolveAliases(file + ext, pkg);
        if (alias !== f) {
          res = res.concat(this.expandFile(alias, extensions, pkg, false));
        }
      }

      res.push(f);
    }

    return res;
  }

  resolveAliases(filename, pkg) {
    // First resolve local package aliases, then project global ones.
    return this.resolvePackageAliases(
      this.resolvePackageAliases(filename, pkg),
      this.rootPackage
    );
  }

  resolvePackageAliases(filename, pkg) {
    // Resolve aliases in the package.alias and package.browser fields.
    if (pkg) {
      return (
        this.getAlias(filename, pkg.pkgdir, pkg.alias) ||
        this.getAlias(filename, pkg.pkgdir, pkg.browser) ||
        filename
      );
    }

    return filename;
  }

  getAlias(filename, dir, aliases) {
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

      alias = aliases[filename];
    } else {
      // It is a node_module. First try the entire filename as a key.
      alias = aliases[filename];
      if (alias == null) {
        // If it didn't match, try only the module name.
        let parts = this.getModuleParts(filename);
        alias = aliases[parts[0]];
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

    // If the alias is a relative path, then resolve
    // relative to the package.json directory.
    if (alias && alias[0] === '.') {
      return path.resolve(dir, alias);
    }

    // Otherwise, assume the alias is a module
    return alias;
  }

  async findPackage(dir) {
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
  }

  async loadAlias(filename, dir) {
    // Load the root project's package.json file if we haven't already
    if (!this.rootPackage) {
      this.rootPackage = await this.findPackage(this.options.rootDir);
    }

    // Load the local package, and resolve aliases
    let pkg = await this.findPackage(dir);
    return this.resolveAliases(filename, pkg);
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

module.exports = Resolver;

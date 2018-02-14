const promisify = require('./utils/promisify');
const resolve = require('resolve');
const resolveAsync = promisify(resolve);
const builtins = require('./builtins');
const path = require('path');
const glob = require('glob');

const browserReplacements = require('node-libs-browser');
for (var key in browserReplacements) {
  if (browserReplacements[key] == null) {
    browserReplacements[key] = builtins['_empty'];
  }
}

class Resolver {
  constructor(options = {}) {
    this.options = options;
    this.cache = new Map();
  }

  async resolve(filename, parent) {
    var resolved = await this.resolveInternal(filename, parent, resolveAsync);
    resolved = this.postResolve(resolved);
    return this.saveCache(filename, parent, resolved);
  }

  resolveSync(filename, parent) {
    var resolved = this.resolveInternal(filename, parent, resolve.sync);
    resolved = this.postResolve(resolved);
    return this.saveCache(filename, parent, resolved);
  }

  postResolve(resolved) {
    if (Array.isArray(resolved)) {
      resolved = {path: resolved[0], pkg: resolved[1]};
    } else if (typeof resolved === 'string') {
      resolved = {path: resolved, pkg: null};
    }

    if (this.options.target === 'browser' && browserReplacements[resolved.path])
      resolved.path = browserReplacements[resolved.path];

    return resolved;
  }

  resolveInternal(filename, parent, resolver) {
    let key = this.getCacheKey(filename, parent);
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    if (glob.hasMagic(filename)) {
      return {path: path.resolve(path.dirname(parent), filename)};
    }

    if (builtins[filename]) return {path: builtins[filename]};

    let extensions = Object.keys(this.options.extensions);
    if (parent) {
      const parentExt = path.extname(parent);
      // parent's extension given high priority
      extensions = [parentExt, ...extensions.filter(ext => ext !== parentExt)];
    }

    return resolver(filename, {
      basedir: path.dirname(parent || filename),
      extensions: extensions,
      paths: this.options.paths,
      packageFilter: (pkg, pkgfile) => {
        // Expose the path to the package.json file
        pkg.pkgfile = pkgfile;

        // libraries like d3.js specifies node.js specific files in the "main" which breaks the build
        // we use the "module" or "jsnext:main" field to get the full dependency tree if available
        const main = [pkg.module, pkg['jsnext:main']].find(
          entry => typeof entry === 'string'
        );

        if (main) {
          pkg.main = main;
        }

        if (
          this.options.target === 'browser' &&
          typeof pkg.browser === 'string'
        ) {
          pkg.main = pkg.browser;
        }

        return pkg;
      },
      pathFilter: (pkg, absolutePath, relativePath) => {
        if (this.options.target === 'browser' && pkg.browser) {
          for (const ext of ['', '.js', '.json']) {
            const key = './' + relativePath + ext;
            if (typeof pkg.browser === 'string') {
              if (key === pkg.main) return pkg.browser;
            } else {
              const replacement = pkg.browser[key];
              if (replacement === false) {
                return builtins['_empty'];
              } else if (typeof replacement === 'string') {
                return replacement;
              }
            }
          }
        }

        return absolutePath;
      }
    });
  }

  getCacheKey(filename, parent) {
    return (parent ? path.dirname(parent) : '') + ':' + filename;
  }

  saveCache(filename, parent, resolved) {
    this.cache.set(this.getCacheKey(filename, parent), resolved);
    return resolved;
  }
}

module.exports = Resolver;

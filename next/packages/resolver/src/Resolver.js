// @flow
import fs from 'fs';
import path from 'path';
import findUp from 'find-up';
import promisify from 'typeable-promisify';

function stat(filePath) {
  return promisify(cb => fs.stat(filePath, cb));
}

function readFile(filePath, encoding = 'utf-8') {
  return promisify(cb => fs.readFile(filePath, encoding, cb));
}

function realpath(filePath) {
  return promisify(cb => fs.realpath(filePath, cb));
}

async function isFile(filePath) {
  try {
    let stats = await stat(filePath);
    return stats.isFile() || stats.isFIFO();
  } catch (err) {
    if (err.code !== 'ENOENT' || err.code === 'ENOTDIR') throw err;
    return false;
  }
}

async function isDirectory(filePath) {
  try {
    let stats = await stat(filePath);
    return stats.isDirectory();
  } catch (err) {
    if (err.code !== 'ENOENT' || err.code === 'ENOTDIR') throw err;
    return false;
  }
}

type FilePath = string; // "/path/to/file/or/directory"
type ModuleRequest = string; // import "./moduleRequest";
type CacheKey = FilePath & ModuleRequest; // "/path/to/file/or/directory:./moduleRequest"
type Extension = string; // .js, .json, etc.

export type ResolverOpts = {
  // ...
};

export type ResolveOpts = {
  extensions?: Array<Extension>,
  rootDir?: string
};

const defaultExtensions = ['.js', '.json'];

export default class Resolver {
  opts: ResolverOpts;
  cache: Map<CacheKey, FilePath>;

  constructor(opts: ResolverOpts = {}) {
    this.opts = opts;
    this.cache = new Map();
  }

  async resolve(sourcePath: FilePath, moduleRequest: ModuleRequest, opts: ResolveOpts = {}) {
    let cacheKey = sourcePath + ':' + moduleRequest;
    let cacheEntry = this.cache.has(cacheKey);
    if (cacheEntry) return cacheEntry;

    let resolved;

    if (moduleRequest.startsWith('.')) {
      resolved = this._resolveRelativePath(sourcePath, moduleRequest, opts);
    } else if (moduleRequest.startsWith('/')) {
      resolved = this._resolveAbsolutePath(sourcePath, moduleRequest, opts);
    } else if (moduleRequest.startsWith('~')) {
      resolved = this._resolveTildePath(sourcePath, moduleRequest, opts);
    } else {
      resolved = this._resolveModulePath(sourcePath, moduleRequest, opts);
    }

    if (!resolved) {
      throw new Error(`Unable to resolve "${moduleRequest}" from "${sourcePath}"`);
    }

    this.cache.set(cacheKey, resolved);
    return resolved;
  }

  async _resolveRelativePath(sourcePath, moduleRequest, opts) {
    let basePath = path.resolve(path.dirname(sourcePath), moduleRequest);
    return this._tryExtensions(basePath, opts);
  }

  async _resolveAbsolutePath(sourcePath, moduleRequest, opts) {
    let basePath = path.resolve(this._getRootDir(opts), moduleRequest.slice(1));
    return this._tryExtensions(basePath, opts);
  }

  async _resolveTildePath(sourcePath, moduleRequest, opts) {
    let packageJsonPath = await this._findClosestPackageJson(sourcePath)
    let projectRoot = path.dirname(packageJsonPath);
    // [TODO: Get Devon's input]
  }

  async _resolveModulePath(sourcePath, moduleRequest, opts) {
    let packageJsonPath = await this._findClosestPackageJsonPath(sourcePath);
    let pkg = await this._readPkg(packageJsonPath);
    let aliases = pkg.alias;

    if (aliases) {
      throw 'implementme';
    }

    let root = path.parse(sourcePath).root;
    let searching = path.dirname(packageJsonPath);
    let { moduleName, moduleSubPath } = this._parseModuleRequest(moduleRequest);
    let moduleDir = null;

    do {
      let testModuleDir = path.join(searching, 'node_modules', moduleName);
      if (await isDirectory(testModuleDir)) {
        moduleDir = testModuleDir;
      }
    } while (
      searching !== root &&
      (searching = path.dirname(searching))
    );

    if (!moduleDir) {
      throw new Error('...');
    }

    let basePath = path.resolve(moduleDir, moduleSubPath);
    let resolved = await this._tryExtensions(basePath, opts);

    if (resolved) {
      return resolved;
    }

    



    // let nodeModulesDir = await findUp(path.join('node_modules'));

    // console.log(nodeModulesDir);

    // ...
    // find project's package.json#alias
    // if alias, rewrite moduleRequest
    //
    // find moduleRequest base ("package name") from node_modules
    // find package.json for matching node_modules/dir
    //
    // resolve against package.json#(main,module,source,browser,etc)
    //   -
  }

  async _tryExtensions(basePath, opts) {
    let extensions = opts.extensions || defaultExtensions;

    for (let extension of extensions) {
      let testPath = basePath + extension;
      if (await isFile(testPath)) {
        return testPath;
      }
    }

    return null; // throw?
  }

  _getRootDir(opts) {
    if (opts.rootDir) {
      return opts.rootDir;
    } else {
      throw new Error('Absolute /paths require opts.rootDir to be defined');
    }
  }

  async _findClosestPackageJsonPath(sourcePath) {
    return await findUp('package.json', { cwd: sourcePath });
  }

  async _readPkg(pkgPath) {
    return JSON.parse(await readFile(pkgPath));
  }

  _parseModuleRequest(moduleRequest) {
    let moduleParts = path.normalize(moduleRequest).split(path.sep);
    let moduleName;
    let moduleSubPath;

    if (moduleRequest.startsWith('@')) {
      moduleName = moduleParts.slice(0, 2).join(path.sep);
      moduleSubPath = moduleParts.slice(2).join(path.sep);
    } else {
      moduleName = moduleParts[0];
      moduleSubPath = moduleParts.slice(1).join(path.sep);
    }

    return {
      moduleName,
      moduleSubPath,
    };
  }
}

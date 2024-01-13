// @flow
import type {FilePath} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {PackageInstaller, ModuleRequest} from '@parcel/package-manager';

import fetch from 'isomorphic-fetch';
import path from 'path';
import semver from 'semver';
import untar from './untar.js';

async function findPackage(fs, dir) {
  while (dir !== '/' && path.basename(dir) !== 'node_modules') {
    const pkg = path.join(dir, 'package.json');
    if (await fs.exists(pkg)) {
      return pkg;
    }

    dir = path.dirname(dir);
  }

  return null;
}

type ResolveCacheEntry = {|
  name: string,
  version: string,
  dependencies: {|[string]: string|},
  devDependencies: {|[string]: string|},
  dist: {|
    fileCount: number,
    integrity: string,
    shasum: string,
    tarball: string,
    unpackedSize: number,
  |},
|};

export default class SimplePackageInstaller implements PackageInstaller {
  fs: FileSystem;
  cache: {|
    resolve: Map<string, ResolveCacheEntry>,
    fetch: Map<string, Map<string, Uint8Array>>,
  |};

  constructor(fs: FileSystem) {
    this.fs = fs;
    this.cache = {
      resolve: new Map(),
      fetch: new Map(),
    };
  }

  // https://github.com/npm/registry/blob/master/docs/REGISTRY-API.md
  // https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md
  async _npmResolve(name: string, version: string): Promise<ResolveCacheEntry> {
    // reuse newest compatible version in cache if possible?
    const cacheEntry = this.cache.resolve.get(`${name}@${version}`);
    if (cacheEntry) {
      return cacheEntry;
    }

    const res = await fetch(`https://registry.npmjs.cf/${name}`, {
      headers: {
        Accept: 'application/vnd.npm.install-v1+json',
        Origin: 'repl.parceljs.org',
      },
    });
    if (!res.ok) {
      throw new Error(`npmResolve failed: fetching ${name} - ${res.status}`);
    }
    const data: {|
      name: string,
      modified: string,
      'dist-tags': {|[string]: string|},
      versions: {|[string]: ResolveCacheEntry|},
    |} = await res.json();

    let resolvedVersion;
    if (version in data['dist-tags']) {
      resolvedVersion = data['dist-tags'][version];
    } else if (semver.validRange(version)) {
      // $FlowFixMe
      resolvedVersion = (semver.maxSatisfying(
        Object.keys(data.versions),
        version,
      ): string);
      if (!resolvedVersion) {
        throw new Error(`npmResolve failed: resolving ${name}@${version}`);
      }
    } else {
      throw new Error(
        `${name}@${version}: only npm semver dependencies are currently supported.`,
      );
    }
    this.cache.resolve.set(
      `${name}@${version}`,
      data.versions[resolvedVersion],
    );
    return data.versions[resolvedVersion];
  }

  async _npmFetch(tarball: string): Promise<Map<string, Uint8Array>> {
    const cacheEntry = this.cache.fetch.get(tarball);
    if (cacheEntry) {
      return cacheEntry;
    }

    const res = await fetch(
      tarball.replace('registry.npmjs.org', 'registry.npmjs.cf'),
    );
    if (!res.ok) {
      throw new Error(`npmFetch failed: fetching ${tarball} - ${res.status}`);
    }

    let result;
    if (!res.arrayBuffer) {
      // node
      var bufs = [];
      res.body.on('data', function(d) {
        bufs.push(d);
      });

      const buffer = await new Promise(resolve =>
        res.body.on('end', () => {
          resolve(Buffer.concat(bufs));
        }),
      );

      result = new ArrayBuffer(buffer.length);
      var view = new Uint8Array(result);
      for (var i = 0; i < buffer.length; ++i) {
        view[i] = buffer[i];
      }
    } else {
      // browser
      result = await res.arrayBuffer();
    }

    let untarred = untar(result);

    this.cache.fetch.set(tarball, untarred);
    return untarred;
  }

  async _getDependency(
    name: string,
    version: string,
  ): Promise<{|
    deps: Array<[string, string]>,
    files: Map<string, Uint8Array>,
    name: string,
  |}> {
    let {
      dependencies: deps,
      dist: {tarball},
    } = await this._npmResolve(name, version);
    let files = await this._npmFetch(tarball);
    return {
      name,
      // $FlowFixMe
      deps: ((deps ? Object.entries(deps) : []): Array<[string, string]>),
      files,
    };
  }

  async _installDependenciesInto(
    dependencies: Array<[string, string]>,
    nodeModules: string,
  ) {
    console.log('_installDependenciesInto', dependencies, nodeModules);
    await this.fs.mkdirp(nodeModules);
    await Promise.all(
      dependencies.map(async ([name, version]) => {
        let {deps, files} = await this._getDependency(name, version);
        await this.fs.mkdirp(path.join(nodeModules, name));
        for (let [filename, arrayBuffer] of files) {
          const p = path.join(nodeModules, name, filename);
          await this.fs.mkdirp(path.dirname(p));

          await this.fs.writeFile(
            p,
            // $FlowFixMe
            /* process.browser ? arrayBuffer :  */ Buffer.from(
              arrayBuffer.buffer,
            ),
          );
        }

        if (deps.length) {
          await this._installDependenciesInto(
            deps,
            path.join(nodeModules, name, 'node_modules'),
          );
        }
      }),
    );
  }

  async init({cwd, dev = true}: {|cwd: string, dev: boolean|}) {
    console.log('init', cwd);
    let pkgPath = await findPackage(this.fs, cwd);
    if (pkgPath) {
      let nodeModules = path.resolve(path.dirname(pkgPath), 'node_modules');

      let pkg = JSON.parse(await this.fs.readFile(pkgPath, 'utf8'));
      // $FlowFixMe
      let dependencies: Array<[string, string]> = [
        pkg.dependencies,
        dev && pkg.devDependencies,
      ]
        .filter(Boolean)
        // $FlowFixMe
        .map(v => (Object.entries(v): Array<[string, string]>))
        .flat(1);

      // if (only) {
      //   dependencies = dependencies.filter(([name]) => only.includes(name));
      // }

      await this._installDependenciesInto(dependencies, nodeModules);
    }
  }

  async install({
    modules,
    cwd,
    saveDev = false,
  }: {|
    modules: Array<ModuleRequest>,
    fs: FileSystem,
    cwd: FilePath,
    packagePath?: ?FilePath,
    saveDev?: boolean,
  |}) {
    try {
      // console.log('install', modules, cwd, saveDev);
      let pkgPath = await findPackage(this.fs, cwd);
      let pkg = pkgPath
        ? JSON.parse(await this.fs.readFile(pkgPath, 'utf8'))
        : {};

      let dest;
      if (saveDev) {
        dest = pkg.devDependencies = pkg.devDependencies || {};
      } else {
        dest = pkg.dependencies = pkg.dependencies || {};
      }

      let modulesResolved: Array<[string, string]> = await Promise.all(
        modules
          .filter(({name}) => !dest[name])
          .map(
            async ({name, range}) =>
              ([
                name,
                (await this._npmResolve(name, range || 'latest')).version,
              ]: [string, string]),
          ),
      );

      for (let [module, version] of modulesResolved) {
        dest[module] = `^${version}`;
      }

      await this.fs.writeFile(
        pkgPath || path.join(cwd, 'package.json'),
        JSON.stringify(pkg),
      );
      await this._installDependenciesInto(
        modulesResolved,
        path.join(cwd, 'node_modules'),
      );
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
}

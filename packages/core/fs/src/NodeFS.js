// @flow
import type {FileSystem} from './types';
import type {FilePath} from '@parcel/types';
import type {
  Event,
  Options as WatcherOptions,
  AsyncSubscription
} from '@parcel/watcher';

import fs from 'fs';
import ncp from 'ncp';
import mkdirp from 'mkdirp';
import rimraf from 'rimraf';
import {registerSerializableClass, promisify} from '@parcel/utils';
import watcher from '@parcel/watcher';
import packageJSON from '../package.json';
import {performance} from 'perf_hooks';
import path from 'path';

// Most of this can go away once we only support Node 10+, which includes
// require('fs').promises

const realpath = promisify(fs.realpath);
const stat = promisify(fs.stat);

let aggregate = 0;
let count = 0;

export class NodeFS implements FileSystem {
  readFile = promisify(fs.readFile);
  writeFile = promisify(fs.writeFile);
  copyFile = promisify(fs.copyFile);
  // stat = promisify(fs.stat);
  readdir = promisify(fs.readdir);
  unlink = promisify(fs.unlink);
  utimes = promisify(fs.utimes);
  mkdirp = promisify(mkdirp);
  rimraf = promisify(rimraf);
  ncp = promisify(ncp);
  createReadStream = fs.createReadStream;
  createWriteStream = fs.createWriteStream;
  cwd = process.cwd;
  chdir = process.chdir;

  readFileSync = fs.readFileSync;
  // statSync = fs.statSync;
  realpathSync = fs.realpathSync;
  // existsSync = fs.existsSync;

  cacheRoots = new Map<string, Set<string>>();

  getCacheRoot(filePath: FilePath) {
    let matches = [...this.cacheRoots.keys()]
      .filter(dir => filePath === dir || filePath.startsWith(dir + path.sep))
      .sort((a, b) => b.length - a.length);

    // console.log(filePath, matches, [...this.cacheRoots.keys()])
    if (matches.length > 0) {
      return this.cacheRoots.get(matches[0]);
    }

    console.log('NO ROOT', filePath, [...this.cacheRoots.keys()]);
    return null;
  }

  existsCached(filePath: FilePath) {
    let cached = this.getCacheRoot(filePath);
    if (!cached) {
      return null;
    }

    return cached.has(filePath);
  }

  async stat(path, ...args) {
    if (this.existsCached(path) === false) {
      let err = new Error('ENOENT');
      err.code = 'ENOENT';
      return err;
    }

    let start = performance.now();
    try {
      return await stat(path, ...args);
    } finally {
      let t = performance.now() - start;
      aggregate += t;
      count++;
      // console.log('STAT', path, t, aggregate, count)
    }
  }

  statSync(path, ...args) {
    if (this.existsCached(path) === false) {
      let err = new Error('ENOENT');
      err.code = 'ENOENT';
      return err;
    }

    let start = performance.now();
    try {
      return fs.statSync(path, ...args);
    } finally {
      let t = performance.now() - start;
      aggregate += t;
      count++;
      // console.log('STAT SYNC', path, t, aggregate, count);
    }
  }

  async realpath(originalPath: string): Promise<string> {
    try {
      return await realpath(originalPath, 'utf8');
    } catch (e) {
      // do nothing
    }

    return originalPath;
  }

  exists(filePath: FilePath): Promise<boolean> {
    let exists = this.existsCached(filePath);
    if (exists != null) {
      return exists;
    }

    let start = performance.now();
    return new Promise(resolve => {
      fs.exists(filePath, r => {
        let t = performance.now() - start;
        aggregate += t;
        count++;
        // console.log('EXISTS', filePath, t, aggregate, count);
        resolve(r);
      });
    });
  }

  existsSync(filePath: FilePath) {
    let exists = this.existsCached(filePath);
    if (exists != null) {
      return exists;
    }

    let start = performance.now();
    try {
      return fs.existsSync(filePath);
    } finally {
      let t = performance.now() - start;
      aggregate += t;
      count++;
      // console.log('EXISTS SYNC', filePath, t, aggregate, count);
    }
  }

  watch(
    dir: FilePath,
    fn: (err: ?Error, events: Array<Event>) => mixed,
    opts: WatcherOptions
  ): Promise<AsyncSubscription> {
    return watcher.subscribe(dir, fn, opts);
  }

  getEventsSince(
    dir: FilePath,
    snapshot: FilePath,
    opts: WatcherOptions
  ): Promise<Array<Event>> {
    return watcher.getEventsSince(dir, snapshot, opts);
  }

  async writeSnapshot(
    dir: FilePath,
    snapshot: FilePath,
    opts: WatcherOptions
  ): Promise<void> {
    await watcher.writeSnapshot(dir, snapshot, opts);
  }

  async cacheRoot(dir: FilePath, opts: WatcherOptions) {
    return;
    let files = await watcher.getTree(dir, opts);

    let set = new Set();
    for (let file of files) {
      let root = path.parse(file).root;
      while (file !== root && !set.has(file)) {
        set.add(file);
        file = path.dirname(file);
      }
    }

    this.cacheRoots.set(dir, set);
  }

  static deserialize(opts) {
    let res = new NodeFS();
    res.cacheRoots = opts.cacheRoots;
    return res;
  }

  serialize() {
    return {cacheRoots: this.cacheRoots};
  }
}

registerSerializableClass(`${packageJSON.version}:NodeFS`, NodeFS);

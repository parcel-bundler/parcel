// @flow
import type {FileSystem} from './types';
import type {FilePath} from '@parcel/types';
import type {
  Event,
  Options as WatcherOptions,
  AsyncSubscription,
} from '@parcel/watcher';

import fs from 'fs';
import ncp from 'ncp';
import mkdirp from 'mkdirp';
import rimraf from 'rimraf';
import {promisify} from '@parcel/utils';
import {registerSerializableClass} from '@parcel/core';
import watcher from '@parcel/watcher';
import fsWriteStreamAtomic from 'fs-write-stream-atomic';
import writeFileAtomic from 'write-file-atomic';
import packageJSON from '../package.json';

// Most of this can go away once we only support Node 10+, which includes
// require('fs').promises

const realpath = promisify(fs.realpath);

export class NodeFS implements FileSystem {
  readFile = promisify(fs.readFile);
  writeFile = promisify(writeFileAtomic);
  copyFile = promisify(fs.copyFile);
  stat = promisify(fs.stat);
  readdir = promisify(fs.readdir);
  unlink = promisify(fs.unlink);
  utimes = promisify(fs.utimes);
  mkdirp = promisify(mkdirp);
  rimraf = promisify(rimraf);
  ncp = promisify(ncp);
  createReadStream = fs.createReadStream;
  createWriteStream = fsWriteStreamAtomic;
  cwd = process.cwd;
  chdir = process.chdir;

  statSync = fs.statSync;
  realpathSync = fs.realpathSync;
  existsSync = fs.existsSync;
  readdirSync = (fs.readdirSync: any);

  readFileSync(filePath: FilePath, encoding?: buffer$Encoding): any {
    if (encoding != null) {
      return fs.readFileSync(filePath, encoding);
    }
    return fs.readFileSync(filePath);
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
    return new Promise(resolve => {
      fs.exists(filePath, resolve);
    });
  }

  watch(
    dir: FilePath,
    fn: (err: ?Error, events: Array<Event>) => mixed,
    opts: WatcherOptions,
  ): Promise<AsyncSubscription> {
    return watcher.subscribe(dir, fn, opts);
  }

  getEventsSince(
    dir: FilePath,
    snapshot: FilePath,
    opts: WatcherOptions,
  ): Promise<Array<Event>> {
    return watcher.getEventsSince(dir, snapshot, opts);
  }

  async writeSnapshot(
    dir: FilePath,
    snapshot: FilePath,
    opts: WatcherOptions,
  ): Promise<void> {
    await watcher.writeSnapshot(dir, snapshot, opts);
  }

  static deserialize() {
    return new NodeFS();
  }

  serialize() {
    return null;
  }
}

registerSerializableClass(`${packageJSON.version}:NodeFS`, NodeFS);

// @flow
import type {Writable} from 'stream';
import type {FileOptions, FileSystem} from './types';
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
import fsWriteStreamAtomic from '@parcel/fs-write-stream-atomic';
import watcher from '@parcel/watcher';
import packageJSON from '../package.json';

// Most of this can go away once we only support Node 10+, which includes
// require('fs').promises

const realpath = promisify(fs.realpath);

export class NodeFS implements FileSystem {
  readFile = promisify(fs.readFile);
  copyFile = promisify(fs.copyFile);
  stat = promisify(fs.stat);
  readdir = promisify(fs.readdir);
  unlink = promisify(fs.unlink);
  utimes = promisify(fs.utimes);
  mkdirp = promisify(mkdirp);
  rimraf = promisify(rimraf);
  ncp = promisify(ncp);
  createReadStream = fs.createReadStream;
  cwd = process.cwd;
  chdir = process.chdir;

  statSync = fs.statSync;
  realpathSync = fs.realpathSync;
  existsSync = fs.existsSync;
  readdirSync = (fs.readdirSync: any);

  createWriteStream(filePath: string, options: any): Writable {
    return fsWriteStreamAtomic(filePath, options);
  }

  async writeFile(
    filePath: FilePath,
    contents: Buffer | string,
    options: ?FileOptions,
  ): Promise<void> {
    let tmpFilePath = getTempFilePath(filePath);
    await fs.promises.writeFile(
      tmpFilePath,
      contents,
      // $FlowFixMe
      options,
    );
    await fs.promises.rename(tmpFilePath, filePath);
  }

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

let writeStreamCalls = 0;

let threadId;
try {
  ({threadId} = require('worker_threads'));
} catch {
  //
}

// Generate a temporary file path used for atomic writing of files.
function getTempFilePath(filePath: FilePath) {
  writeStreamCalls = writeStreamCalls % Number.MAX_SAFE_INTEGER;
  return (
    filePath +
    '.' +
    process.pid +
    (threadId != null ? '.' + threadId : '') +
    '.' +
    (writeStreamCalls++).toString(36)
  );
}

// @flow

import type {FileSystem, FileOptions} from './types';
import type {FilePath} from '@parcel/types';
import type {
  Event,
  Options as WatcherOptions,
  AsyncSubscription
} from '@parcel/watcher';
import path from 'path';
import {Readable, Writable} from 'stream';
import {registerSerializableClass} from '@parcel/utils';
import packageJSON from '../package.json';
import WorkerFarm, {Handle} from '@parcel/workers';
import nullthrows from 'nullthrows';

const instances = new Map();
let id = 0;

type HandleFunction = (...args: Array<any>) => any;
type SerializedHandle = {|id: number|};
type SerializedMemoryFS = {|
  id: number,
  handle: SerializedHandle
|};

export class MemoryFS implements FileSystem {
  dirs: Map<FilePath, Directory>;
  files: Map<FilePath, File>;
  symlinks: Map<FilePath, FilePath>;
  watchers: Map<FilePath, Set<Watcher>>;
  events: Array<Event>;
  id: number;
  handle: Handle;
  farm: WorkerFarm;
  _cwd: FilePath;

  constructor(workerFarm: WorkerFarm) {
    this.dirs = new Map([['/', new Directory()]]);
    this.farm = workerFarm;
    this.files = new Map();
    this.symlinks = new Map();
    this.watchers = new Map();
    this.events = [];
    this.id = id++;
    this._cwd = '/';
    instances.set(this.id, this);
  }

  static deserialize(opts: SerializedMemoryFS) {
    return (
      instances.get(opts.id) || new WorkerFS(opts.id, nullthrows(opts.handle))
    );
  }

  serialize(): SerializedMemoryFS {
    if (!this.handle) {
      this.handle = this.farm.createReverseHandle(
        (fn: string, args: Array<mixed>) => {
          // $FlowFixMe
          return this[fn](...args);
        }
      );
    }

    return {
      id: this.id,
      handle: this.handle.serialize()
    };
  }

  cwd() {
    return this._cwd;
  }

  chdir(dir: FilePath) {
    this._cwd = dir;
  }

  _normalizePath(filePath: FilePath, realpath: boolean = true): FilePath {
    filePath = path.resolve(this.cwd(), filePath);

    // get realpath by following symlinks
    if (realpath) {
      let {root, dir, base} = path.parse(filePath);
      let parts = dir
        .slice(root.length)
        .split(path.sep)
        .concat(base);
      let res = root;
      for (let part of parts) {
        res = path.join(res, part);
        let symlink = this.symlinks.get(res);
        if (symlink) {
          res = symlink;
        }
      }

      return res;
    }

    return filePath;
  }

  writeFile(
    filePath: FilePath,
    contents: Buffer | string,
    options: ?FileOptions
  ) {
    filePath = this._normalizePath(filePath);
    if (this.dirs.has(filePath)) {
      throw new FSError('EISDIR', filePath, 'is a directory');
    }

    let dir = path.dirname(filePath);
    if (!this.dirs.has(dir)) {
      throw new FSError('ENOENT', dir, 'does not exist');
    }

    let buffer = makeShared(contents);
    let file = this.files.get(filePath);
    let mode = (options && options.mode) || 0o666;
    if (file) {
      file.write(buffer, mode);
    } else {
      this.files.set(filePath, new File(buffer, mode));
    }

    this._triggerEvent({
      type: file ? 'update' : 'create',
      path: filePath
    });

    return Promise.resolve();
  }

  readFile(filePath: FilePath, encoding?: buffer$Encoding): Promise<any> {
    filePath = this._normalizePath(filePath);
    let file = this.files.get(filePath);
    if (file == null) {
      throw new FSError('ENOENT', filePath, 'does not exist');
    }

    let buffer = file.read();
    if (encoding) {
      return Promise.resolve(buffer.toString(encoding));
    }

    return Promise.resolve(buffer);
  }

  async copyFile(source: FilePath, destination: FilePath) {
    let contents = await this.readFile(source);
    await this.writeFile(destination, contents);
  }

  stat(filePath: FilePath) {
    filePath = this._normalizePath(filePath);

    let dir = this.dirs.get(filePath);
    if (dir) {
      return Promise.resolve(dir.stat());
    }

    let file = this.files.get(filePath);
    if (file == null) {
      throw new FSError('ENOENT', filePath, 'does not exist');
    }

    return Promise.resolve(file.stat());
  }

  readdir(dir: FilePath) {
    dir = this._normalizePath(dir);
    if (!this.dirs.has(dir)) {
      throw new FSError('ENOENT', dir, 'does not exist');
    }

    dir += path.sep;

    let res = [];
    for (let filePath of this.files.keys()) {
      if (filePath.startsWith(dir)) {
        let end = filePath.indexOf(path.sep, dir.length);
        if (end === -1) {
          end = filePath.length;
        }
        res.push(filePath.slice(dir.length, end));
      }
    }

    return Promise.resolve(res);
  }

  unlink(filePath: FilePath) {
    filePath = this._normalizePath(filePath);
    if (!this.files.has(filePath) && !this.dirs.has(filePath)) {
      throw new FSError('ENOENT', filePath, 'does not exist');
    }

    this.files.delete(filePath);
    this.dirs.delete(filePath);

    this.symlinks.delete(filePath);
    this.watchers.delete(filePath);

    this._triggerEvent({
      type: 'delete',
      path: filePath
    });

    return Promise.resolve();
  }

  mkdirp(dir: FilePath) {
    dir = this._normalizePath(dir);
    if (this.dirs.has(dir)) {
      return Promise.resolve();
    }

    if (this.files.has(dir)) {
      throw new FSError('ENOENT', dir, 'is not a directory');
    }

    let root = path.parse(dir).root;
    while (dir !== root) {
      if (this.dirs.has(dir)) {
        break;
      }

      this.dirs.set(dir, new Directory());

      this._triggerEvent({
        type: 'create',
        path: dir
      });

      dir = path.dirname(dir);
    }

    return Promise.resolve();
  }

  rimraf(filePath: FilePath) {
    filePath = this._normalizePath(filePath);

    if (this.dirs.has(filePath)) {
      let dir = filePath + path.sep;
      for (let filePath of this.files.keys()) {
        if (filePath.startsWith(dir)) {
          this.files.delete(filePath);

          this._triggerEvent({
            type: 'delete',
            path: filePath
          });
        }
      }

      for (let dirPath of this.dirs.keys()) {
        if (dirPath.startsWith(dir)) {
          this.dirs.delete(dirPath);
          this.watchers.delete(dirPath);

          this._triggerEvent({
            type: 'delete',
            path: dirPath
          });
        }
      }

      for (let filePath of this.symlinks.keys()) {
        if (filePath.startsWith(dir)) {
          this.symlinks.delete(filePath);
        }
      }

      this.dirs.delete(filePath);
      this._triggerEvent({
        type: 'delete',
        path: filePath
      });
    } else if (this.files.has(filePath)) {
      this.files.delete(filePath);
      this._triggerEvent({
        type: 'delete',
        path: filePath
      });
    }

    return Promise.resolve();
  }

  async ncp(source: FilePath, destination: FilePath) {
    source = this._normalizePath(source);

    if (this.dirs.has(source)) {
      if (!this.dirs.has(destination)) {
        this.dirs.set(destination, new Directory());
        this._triggerEvent({
          type: 'create',
          path: destination
        });
      }

      let dir = source + path.sep;
      for (let dirPath of this.dirs.keys()) {
        if (dirPath.startsWith(dir)) {
          let destName = path.join(destination, dirPath.slice(dir.length));
          if (!this.dirs.has(destName)) {
            this.dirs.set(destName, new Directory());
            this._triggerEvent({
              type: 'create',
              path: destName
            });
          }
        }
      }

      for (let [filePath, buffer] of this.files) {
        if (filePath.startsWith(dir)) {
          let destName = path.join(destination, filePath.slice(dir.length));
          let exists = this.files.has(destName);
          this.files.set(destName, buffer);
          this._triggerEvent({
            type: exists ? 'update' : 'create',
            path: destName
          });
        }
      }
    } else {
      await this.copyFile(source, destination);
    }
  }

  createReadStream(filePath: FilePath) {
    return new ReadStream(this, filePath);
  }

  createWriteStream(filePath: FilePath, options: ?FileOptions) {
    return new WriteStream(this, filePath, options);
  }

  realpath(filePath: FilePath) {
    filePath = this._normalizePath(filePath);
    return Promise.resolve(filePath);
  }

  symlink(target: FilePath, path: FilePath) {
    target = this._normalizePath(target);
    path = this._normalizePath(path);
    this.symlinks.set(path, target);
    return Promise.resolve();
  }

  exists(filePath: FilePath) {
    filePath = this._normalizePath(filePath);
    return Promise.resolve(this.files.has(filePath) || this.dirs.has(filePath));
  }

  _triggerEvent(event: Event) {
    this.events.push(event);

    for (let [dir, watchers] of this.watchers) {
      if (!dir.endsWith(path.sep)) {
        dir += path.sep;
      }

      if (event.path.startsWith(dir)) {
        for (let watcher of watchers) {
          watcher.trigger([event]);
        }
      }
    }
  }

  watch(
    dir: FilePath,
    fn: (err: ?Error, events: Array<Event>) => mixed,
    opts: WatcherOptions
  ): Promise<AsyncSubscription> {
    let watcher = new Watcher(fn, opts);
    let watchers = this.watchers.get(dir);
    if (!watchers) {
      watchers = new Set();
      this.watchers.set(dir, watchers);
    }

    watchers.add(watcher);

    return Promise.resolve({
      unsubscribe: () => {
        watchers = nullthrows(watchers);
        watchers.delete(watcher);

        if (watchers.size === 0) {
          this.watchers.delete(dir);
        }

        return Promise.resolve();
      }
    });
  }

  async getEventsSince(
    dir: FilePath,
    snapshot: FilePath,
    opts: WatcherOptions
  ): Promise<Array<Event>> {
    let contents = await this.readFile(snapshot, 'utf8');
    let len = Number(contents);
    let events = this.events.slice(len);
    let ignore = opts.ignore;
    if (ignore) {
      events = events.filter(
        event => !ignore.some(i => event.path.startsWith(i + path.sep))
      );
    }

    return events;
  }

  async writeSnapshot(dir: FilePath, snapshot: FilePath): Promise<void> {
    await this.writeFile(snapshot, '' + this.events.length);
  }
}

class Watcher {
  fn: (err: ?Error, events: Array<Event>) => mixed;
  options: WatcherOptions;

  constructor(
    fn: (err: ?Error, events: Array<Event>) => mixed,
    options: WatcherOptions
  ) {
    this.fn = fn;
    this.options = options;
  }

  trigger(events: Array<Event>) {
    let ignore = this.options.ignore;
    if (ignore) {
      events = events.filter(
        event => !ignore.some(i => event.path.startsWith(i + path.sep))
      );
    }

    this.fn(null, events);
  }
}

class FSError extends Error {
  code: string;
  path: FilePath;
  constructor(code: string, path: FilePath, message: string) {
    super(`${code}: ${path} ${message}`);
    this.name = 'FSError';
    this.code = code;
    this.path = path;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ReadStream extends Readable {
  fs: FileSystem;
  filePath: FilePath;
  reading: boolean;
  bytesRead: number;
  constructor(fs: FileSystem, filePath: FilePath) {
    super();
    this.fs = fs;
    this.filePath = filePath;
    this.reading = false;
    this.bytesRead = 0;
  }

  _read() {
    if (this.reading) {
      return;
    }

    this.reading = true;
    this.fs.readFile(this.filePath).then(
      res => {
        this.bytesRead += res.byteLength;
        this.push(res);
        this.push(null);
      },
      err => {
        this.emit('error', err);
      }
    );
  }
}

class WriteStream extends Writable {
  fs: FileSystem;
  filePath: FilePath;
  options: ?FileOptions;
  buffer: Buffer;
  constructor(fs: FileSystem, filePath: FilePath, options: ?FileOptions) {
    super();
    this.fs = fs;
    this.filePath = filePath;
    this.options = options;
    this.buffer = Buffer.alloc(0);
  }

  _write(
    chunk: Buffer | string,
    encoding: any,
    callback: (error?: Error) => void
  ) {
    let c = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.buffer = Buffer.concat([this.buffer, c]);
    callback();
  }

  _final(callback: (error?: Error) => void) {
    this.fs
      .writeFile(this.filePath, this.buffer, this.options)
      .then(() => callback(), err => callback(err));
  }

  get bytesWritten() {
    return this.buffer.byteLength;
  }
}

const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

class Entry {
  mode: number;
  atime: number;
  mtime: number;
  ctime: number;
  birthtime: number;
  constructor(mode: number) {
    this.mode = mode;
    let now = Date.now();
    this.atime = now;
    this.mtime = now;
    this.ctime = now;
    this.birthtime = now;
  }

  access() {
    let now = Date.now();
    this.atime = now;
    this.ctime = now;
  }

  modify(mode: number) {
    let now = Date.now();
    this.mtime = now;
    this.ctime = now;
    this.mode = mode;
  }

  getSize() {
    return 0;
  }

  stat() {
    return new Stat(this);
  }
}

class Stat {
  dev = 0;
  ino = 0;
  mode: number;
  nlink = 0;
  uid = 0;
  gid = 0;
  rdev = 0;
  size: number;
  blksize = 0;
  blocks = 0;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;

  constructor(entry: Entry) {
    this.mode = entry.mode;
    this.size = entry.getSize();
    this.atimeMs = entry.atime;
    this.mtimeMs = entry.mtime;
    this.ctimeMs = entry.ctime;
    this.birthtimeMs = entry.birthtime;
    this.atime = new Date(entry.atime);
    this.mtime = new Date(entry.mtime);
    this.ctime = new Date(entry.ctime);
    this.birthtime = new Date(entry.birthtime);
  }

  isFile() {
    return Boolean(this.mode & S_IFREG);
  }

  isDirectory() {
    return Boolean(this.mode & S_IFDIR);
  }

  isBlockDevice() {
    return false;
  }
  isCharacterDevice() {
    return false;
  }
  isSymbolicLink() {
    return false;
  }
  isFIFO() {
    return false;
  }
  isSocket() {
    return false;
  }
}

class File extends Entry {
  buffer: Buffer;
  constructor(buffer: Buffer, mode: number) {
    super(S_IFREG | mode);
    this.buffer = buffer;
  }

  read(): Buffer {
    super.access();
    return this.buffer;
  }

  write(buffer: Buffer, mode: number) {
    super.modify(S_IFREG | mode);
    this.buffer = buffer;
  }

  getSize() {
    return this.buffer.length;
  }
}

class Directory extends Entry {
  constructor() {
    super(S_IFDIR);
  }
}

function makeShared(contents: Buffer | string): Buffer {
  if (
    typeof contents !== 'string' &&
    contents.buffer instanceof SharedArrayBuffer
  ) {
    return Buffer.from(contents.buffer);
  }

  let length = Buffer.byteLength(contents);
  let shared = new SharedArrayBuffer(length);
  let buffer = Buffer.from(shared);
  if (typeof contents === 'string') {
    buffer.write(contents);
  } else {
    contents.copy(buffer);
  }

  return buffer;
}

class WorkerFS extends MemoryFS {
  id: number;
  handleFn: HandleFunction;
  serializedHandle: SerializedHandle;

  constructor(id: number, serializedHandle: {|id: number|}) {
    // TODO Make this not a subclass
    // $FlowFixMe
    super();
    this.id = id;
    this.handleFn = Handle.deserialize(serializedHandle);
    this.serializedHandle = serializedHandle;
  }

  static deserialize(opts: SerializedMemoryFS) {
    return instances.get(opts.id);
  }

  serialize(): SerializedMemoryFS {
    return {
      id: this.id,
      handle: this.handle.serialize()
    };
  }

  writeFile(
    filePath: FilePath,
    contents: Buffer | string,
    options: ?FileOptions
  ) {
    let buffer = makeShared(contents);
    return this.handleFn('writeFile', [filePath, buffer, options]);
  }

  async readFile(filePath: FilePath, encoding?: buffer$Encoding) {
    let buffer = await this.handleFn('readFile', [filePath]);
    if (encoding) {
      return Buffer.from(buffer).toString(encoding);
    }

    return buffer;
  }

  stat(filePath: FilePath) {
    return this.handleFn('stat', [filePath]);
  }

  readdir(dir: FilePath) {
    return this.handleFn('readdir', [dir]);
  }

  unlink(filePath: FilePath) {
    return this.handleFn('unlink', [filePath]);
  }

  mkdirp(dir: FilePath) {
    return this.handleFn('mkdirp', [dir]);
  }

  rimraf(filePath: FilePath) {
    return this.handleFn('rimraf', [filePath]);
  }

  ncp(source: FilePath, destination: FilePath) {
    return this.handleFn('ncp', [source, destination]);
  }

  realpath(filePath: FilePath) {
    return this.handleFn('realpath', [filePath]);
  }

  symlink(target: FilePath, path: FilePath) {
    return this.handleFn('symlink', [target, path]);
  }

  exists(filePath: FilePath) {
    return this.handleFn('exists', [filePath]);
  }
}

registerSerializableClass(`${packageJSON.version}:MemoryFS`, MemoryFS);
registerSerializableClass(`${packageJSON.version}:WorkerFS`, WorkerFS);
registerSerializableClass(`${packageJSON.version}:Stat`, Stat);

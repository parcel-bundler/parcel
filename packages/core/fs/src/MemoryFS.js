// @flow
import type {FileSystem, FileOptions} from './types';
import type {FilePath} from '@parcel/types';
import path from 'path';
import {Readable, Writable} from 'stream';
import {registerSerializableClass} from '@parcel/utils';
import packageJSON from '../package.json';
import WorkerFarm from '@parcel/workers';
import nullthrows from 'nullthrows';

const instances = new Map();
let id = 0;

type FSHandle = (fn: string, args: any[]) => any;
type SerializedMemoryFS = {
  id: number,
  handle?: FSHandle
};

export class MemoryFS implements FileSystem {
  dirs: Map<FilePath, Directory>;
  files: Map<FilePath, File>;
  id: number;
  handle: any;
  constructor() {
    this.dirs = new Map([['/', new Directory()]]);
    this.files = new Map();
    this.id = id++;
    instances.set(this.id, this);
  }

  static deserialize(opts: SerializedMemoryFS) {
    return (
      instances.get(opts.id) || new WorkerFS(opts.id, nullthrows(opts.handle))
    );
  }

  serialize(): SerializedMemoryFS {
    if (!this.handle) {
      this.handle = WorkerFarm.createReverseHandle(
        async (fn: string, args: any[]) => {
          // $FlowFixMe
          return this[fn](...args);
        }
      );
    }

    return {
      id: this.id,
      handle: this.handle
    };
  }

  cwd() {
    return '/';
  }

  _normalizePath(filePath: FilePath): FilePath {
    return path.resolve(this.cwd(), filePath);
  }

  async writeFile(
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

    // console.log(contents.buffer)
    let buffer = makeShared(contents);
    let file = this.files.get(filePath);
    let mode = (options && options.mode) || 0o666;
    if (file) {
      file.write(buffer, mode);
    } else {
      this.files.set(filePath, new File(buffer, mode));
    }
  }

  async readFile(filePath: FilePath, encoding?: buffer$Encoding): Promise<any> {
    filePath = this._normalizePath(filePath);
    let file = this.files.get(filePath);
    if (file == null) {
      throw new FSError('ENOENT', filePath, 'does not exist');
    }

    let buffer = file.read();
    if (encoding) {
      return buffer.toString(encoding);
    }

    return buffer;
  }

  async copyFile(source: FilePath, destination: FilePath) {
    let contents = await this.readFile(source);
    await this.writeFile(destination, contents);
  }

  async stat(filePath: FilePath) {
    filePath = this._normalizePath(filePath);

    let dir = this.dirs.get(filePath);
    if (dir) {
      return dir.stat();
    }

    let file = this.files.get(filePath);
    if (file == null) {
      throw new FSError('ENOENT', filePath, 'does not exist');
    }

    return file.stat();
  }

  async readdir(dir: FilePath) {
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

    return res;
  }

  async unlink(filePath: FilePath) {
    filePath = this._normalizePath(filePath);
    if (!this.files.has(filePath) && !this.dirs.has(filePath)) {
      throw new FSError('ENOENT', filePath, 'does not exist');
    }

    this.files.delete(filePath);
    this.dirs.delete(filePath);
  }

  async mkdirp(dir: FilePath) {
    dir = this._normalizePath(dir);
    if (this.dirs.has(dir)) {
      return;
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
      dir = path.dirname(dir);
    }
  }

  async rimraf(filePath: FilePath) {
    filePath = this._normalizePath(filePath);

    if (this.dirs.has(filePath)) {
      let dir = filePath + path.sep;
      for (let filePath of this.files.keys()) {
        if (filePath.startsWith(dir)) {
          this.files.delete(filePath);
        }
      }

      for (let dirPath of this.dirs.keys()) {
        if (dirPath.startsWith(dir)) {
          this.dirs.delete(dirPath);
        }
      }
    }

    this.dirs.delete(filePath);
    this.files.delete(filePath);
  }

  async ncp(source: FilePath, destination: FilePath) {
    source = this._normalizePath(source);

    if (this.dirs.has(source)) {
      if (!this.dirs.has(destination)) {
        this.dirs.set(destination, new Directory());
      }

      let dir = source + path.sep;
      for (let dirPath of this.dirs.keys()) {
        if (dirPath.startsWith(dir)) {
          let destName = path.join(destination, dirPath.slice(dir.length));
          if (!this.dirs.has(destName)) {
            this.dirs.set(destName, new Directory());
          }
        }
      }

      for (let [filePath, buffer] of this.files) {
        if (filePath.startsWith(dir)) {
          let destName = path.join(destination, filePath.slice(dir.length));
          this.files.set(destName, buffer);
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

  async realpath(filePath: FilePath) {
    filePath = this._normalizePath(filePath);
    return filePath;
  }

  async exists(filePath: FilePath) {
    filePath = this._normalizePath(filePath);
    return this.files.has(filePath) || this.dirs.has(filePath);
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
    return {
      dev: 0,
      ino: 0,
      mode: this.mode,
      nlink: 0,
      uid: 0,
      gid: 0,
      rdev: 0,
      size: this.getSize(),
      blksize: 0,
      blocks: 0,
      atimeMs: this.atime,
      mtimeMs: this.mtime,
      ctimeMs: this.ctime,
      birthtimeMs: this.birthtime,
      atime: new Date(this.atime),
      mtime: new Date(this.mtime),
      ctime: new Date(this.ctime),
      birthtime: new Date(this.birthtime),
      isFile: () => Boolean(this.mode & S_IFREG),
      isDirectory: () => Boolean(this.mode & S_IFDIR),
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false
    };
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
  handle: FSHandle;

  constructor(id: number, handle: FSHandle) {
    super();
    this.id = id;
    this.handle = handle;
  }

  static deserialize(opts: SerializedMemoryFS) {
    return instances.get(opts.id);
  }

  serialize(): SerializedMemoryFS {
    return {
      id: this.id
    };
  }

  async writeFile(
    filePath: FilePath,
    contents: Buffer | string,
    options: ?FileOptions
  ) {
    let buffer = makeShared(contents);
    return this.handle('writeFile', [filePath, buffer, options]);
  }

  async readFile(filePath: FilePath, encoding?: buffer$Encoding) {
    let buffer = await this.handle('readFile', [filePath]);
    if (encoding) {
      return Buffer.from(buffer).toString(encoding);
    }

    return buffer;
  }

  async stat(filePath: FilePath) {
    return this.handle('stat', [filePath]);
  }

  async readdir(dir: FilePath) {
    return this.handle('readdir', [dir]);
  }

  async unlink(filePath: FilePath) {
    return this.handle('unlink', [filePath]);
  }

  async mkdirp(dir: FilePath) {
    return this.handle('mkdirp', [dir]);
  }

  async rimraf(filePath: FilePath) {
    return this.handle('rimraf', [filePath]);
  }

  async ncp(source: FilePath, destination: FilePath) {
    return this.handle('ncp', [source, destination]);
  }

  async exists(filePath: FilePath) {
    return this.handle('exists', [filePath]);
  }
}

registerSerializableClass(`${packageJSON.version}:MemoryFS`, MemoryFS);
registerSerializableClass(`${packageJSON.version}:WorkerFS`, WorkerFS);

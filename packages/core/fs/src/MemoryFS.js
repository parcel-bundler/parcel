// @flow
import type {FileSystem} from './types';
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
  dirs: Set<FilePath>;
  files: Map<FilePath, Buffer>;
  id: number;
  handle: any;
  constructor() {
    this.dirs = new Set(['/']);
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

  async writeFile(filePath: FilePath, contents: Buffer | string) {
    filePath = this._normalizePath(filePath);
    if (this.dirs.has(filePath)) {
      throw new Error(`EISDIR: ${filePath} is a directory`);
    }

    let dir = path.dirname(filePath);
    if (!this.dirs.has(dir)) {
      throw new Error(`ENOENT: ${dir} does not exist`);
    }

    // console.log(contents.buffer)
    let buffer = makeShared(contents);
    this.files.set(filePath, buffer);
  }

  async readFile(filePath: FilePath, encoding?: buffer$Encoding): Promise<any> {
    filePath = this._normalizePath(filePath);
    let buffer = this.files.get(filePath);
    if (buffer == null) {
      throw new Error(`${filePath} does not exist`);
    }

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

    if (this.dirs.has(filePath)) {
      return createStat(0, true);
    }

    let buffer = this.files.get(filePath);
    if (buffer == null) {
      throw new Error(`ENOENT: ${filePath} does not exist`);
    }

    return createStat(buffer.byteLength, false);
  }

  async readdir(dir: FilePath) {
    dir = this._normalizePath(dir);
    if (!this.dirs.has(dir)) {
      throw new Error(`ENOENT: ${dir} does not exist`);
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
      throw new Error(`${filePath} does not exist`);
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
      throw new Error('ENOTDIR: Not a directory');
    }

    let root = path.parse(dir).root;
    while (dir !== root) {
      if (this.dirs.has(dir)) {
        break;
      }

      this.dirs.add(dir);
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
      this.dirs.add(destination);

      let dir = source + path.sep;
      for (let dirPath of this.dirs) {
        if (dirPath.startsWith(dir)) {
          let destName = path.join(destination, dirPath.slice(dir.length));
          this.dirs.add(destName);
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
    let fs = this;
    class ReadStream extends Readable {
      _read() {
        fs.readFile(filePath).then(
          res => {
            this.push(res);
            this.push(null);
          },
          err => {
            this.emit('error', err);
          }
        );
      }
    }

    return new ReadStream();
  }

  createWriteStream(filePath: FilePath) {
    let fs = this;
    let buffer = Buffer.alloc(0);
    class WriteStream extends Writable {
      _write(
        chunk: Buffer | string,
        encoding: any,
        callback: (error?: Error) => void
      ) {
        let c = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        buffer = Buffer.concat([buffer, c]);
        callback();
      }

      _final(callback: (error?: Error) => void) {
        fs.writeFile(filePath, buffer).then(callback);
      }
    }

    return new WriteStream();
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

function createStat(size, isDir) {
  return {
    dev: 0,
    ino: 0,
    mode: 0,
    nlink: 0,
    uid: 0,
    gid: 0,
    rdev: 0,
    size,
    blksize: 0,
    blocks: 0,
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: new Date(0),
    mtime: new Date(0),
    ctime: new Date(0),
    birthtime: new Date(0),
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false
  };
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

  async writeFile(filePath: FilePath, contents: Buffer | string) {
    let buffer = makeShared(contents);
    return this.handle('writeFile', [filePath, buffer]);
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

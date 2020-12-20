import {
  MemoryFS,
  FSError,
  makeShared,
  File,
  // eslint-disable-next-line
} from './MemoryFS.js';
import path from 'path';
import {registerSerializableClass} from '@parcel/core';
import packageJSON from '../package.json';

const {Buffer} = require('buffer');

const CONSTANTS = {
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  S_IFMT: 61440,
  S_IFREG: 32768,
  S_IFDIR: 16384,
  S_IFCHR: 8192,
  S_IFBLK: 24576,
  S_IFIFO: 4096,
  S_IFLNK: 40960,
  S_IFSOCK: 49152,
  O_CREAT: 64,
  O_EXCL: 128,
  O_NOCTTY: 256,
  O_TRUNC: 512,
  O_APPEND: 1024,
  O_DIRECTORY: 65536,
  O_NOATIME: 262144,
  O_NOFOLLOW: 131072,
  O_SYNC: 1052672,
  O_DIRECT: 16384,
  O_NONBLOCK: 2048,
};

function asyncToNode(args, num, f) {
  let cb, params;
  if (args.length === num) {
    cb = args[args.length - 1];
    params = args.slice(0, -1);
  } else {
    let maybeCb = args[args.length - 1];
    if (typeof maybeCb === 'function') {
      cb = maybeCb;
      params = args.slice(0, -1);
    } else {
      params = args;
    }
  }

  let result = Promise.resolve(f(...params));
  if (cb) {
    result.then(res => cb(null, res), err => cb(err));
  } else {
    return result;
  }
}

// 'a': a. create if missing
// 'ax': a. throw if exists
// 'a+': ra. create if missing
// 'ax+': ra. throw if exists
// 'r': r. throw if missing
// 'r+': rw. throw if missing
// 'w': w. create if missing, clear if exists
// 'wx': w. create if missing, throw if exists
// 'w+': rw. create if missing, clear if exists
// 'wx+': rw. create if missing, throw if exists
// O_RDONLY	Flag indicating to open a file for read-only access.
// O_WRONLY	Flag indicating to open a file for write-only access.
// O_RDWR	Flag indicating to open a file for read-write access.

// O_CREAT	Flag indicating to create the file if it does not already exist.
// O_EXCL	Flag indicating that opening a file should fail if the O_CREAT flag is set and the file already exists.

// O_TRUNC	Flag indicating that if the file exists and is a regular file, and the file is opened successfully for write access, its length shall be truncated to zero.
// O_APPEND	Flag indicating that data will be appended to the end of the file.
// O_DIRECTORY	Flag indicating that the open should fail if the path is not a directory.
// O_NOFOLLOW	Flag indicating that the open should fail if the path is a symbolic link.

const FD_MAX = 4096;
function parseOpenFlags(flags) {
  let flagsBits = 0;
  if (typeof flags === 'number') {
    flagsBits = flags;
  } else {
    flags = [...flags].filter(c => c !== 's').join('');
    if (flags.includes('a')) {
      flagsBits |= CONSTANTS.O_APPEND | CONSTANTS.O_CREAT;
      if (flags.includes('+')) {
        flagsBits |= CONSTANTS.O_RDWR;
      } else {
        flagsBits |= CONSTANTS.O_RDONLY;
      }
      if (flags.includes('x')) {
        flagsBits |= CONSTANTS.O_EXCL;
      }
    } else if (flags.includes('r')) {
      if (flags.includes('+')) {
        flagsBits |= CONSTANTS.O_RDWR;
      } else {
        flagsBits |= CONSTANTS.O_RDONLY;
      }
    } else if (flags.includes('w')) {
      flagsBits |= CONSTANTS.O_CREAT;
      if (flags.includes('+')) {
        flagsBits |= CONSTANTS.O_RDWR;
      } else {
        flagsBits |= CONSTANTS.O_WRONLY;
      }
      if (flags.includes('x')) {
        flagsBits |= CONSTANTS.O_EXCL;
      } else {
        flagsBits |= CONSTANTS.O_TRUNC;
      }
    }
  }

  return flagsBits;
}

export class ExtendedMemoryFS extends MemoryFS {
  constructor(...args) {
    super(...args);
    this.openFDs = new Map();
    this.nextFD = 1;
  }

  // eslint-disable-next-line
  async _mkdir(dir, options = {}) {
    let {recursive = false} = options;

    if (!recursive) {
      if (!this.dirs.has(path.dirname(dir))) {
        throw new FSError('ENOENT', path.dirname(dir), 'is not a directory');
      }
      if (this.dirs.has(dir)) {
        throw new FSError('EEXIST', dir, 'already exists');
      }
    }

    return super.mkdirp(dir);
  }

  async _rmdir(filePath, options = {}) {
    let {recursive = false} = options;

    if (!recursive) {
      if (!this.dirs.has(filePath) && !this.files.has(filePath)) {
        throw new FSError('ENOENT', filePath, 'is not a directory');
      }
      if (
        this.dirs.has(filePath) &&
        (await this.readdir(filePath)).length > 0
      ) {
        throw new FSError('ENOTEMPTY', filePath, "isn't empty");
      }
    }

    return super.rimraf(filePath);
  }

  // --------------------------------

  rmdir(...args) {
    return asyncToNode(args, 3, (...p) => this._rmdir(...p));
  }
  mkdir(...args) {
    return asyncToNode(args, 3, (...p) => this._mkdir(...p));
  }
  readdir(...args) {
    return asyncToNode(args, 3, (...p) => super.readdir(...p));
  }
  unlink(...args) {
    return asyncToNode(args, 2, (...p) => super.unlink(...p));
  }
  copyFile(...args) {
    return asyncToNode(args, 3, (...p) => super.copyFile(...p));
  }
  realpath(...args) {
    return asyncToNode(args, 3, (...p) => super.realpath(...p));
  }
  readFile(...args) {
    return asyncToNode(args, 3, (...p) => super.readFile(...p));
  }
  symlink(...args) {
    return asyncToNode(args, 4, (...p) => super.symlink(...p));
  }
  writeFile(...args) {
    return asyncToNode(args, 4, (...p) => super.writeFile(...p));
  }
  stat(...args) {
    return asyncToNode(args, 2, (...p) => super.stat(...p));
  }
  lstat(...args) {
    return asyncToNode(args, 2, (...p) => super.stat(...p));
  }
  lstatSync(...args) {
    return this.statSync(...args);
  }
  exists(filePath, cb) {
    let result = super.exists(filePath);
    if (cb != null) {
      result.then(res => cb(res));
    } else {
      return result;
    }
  }
  // --------------------------------
  chmodSync() {}
  renameSync(oldPath, newPath) {
    if (this.files.has(oldPath)) {
      let file = this.files.get(oldPath);
      this.files.delete(oldPath);
      if (this.dirs.has(newPath)) {
        this.files.set(newPath + '/' + path.basename(oldPath), file);
      } else {
        this.files.set(newPath, file);
        this.symlinks.delete(newPath);
      }
      return;
    }

    if (this.symlinks.has(oldPath)) {
      let target = this.symlinks.get(oldPath);
      this.symlinks.delete(oldPath);
      this.symlinks.set(newPath, target);
      return;
    }

    if (this.dirs.has(oldPath)) {
      let dir = this.dirs.get(oldPath);
      this.dirs.delete(oldPath);
      this.dirs.set(newPath, dir);
      return;
    }

    throw new FSError('ENOENT', path.dirname(oldPath), "wasn't found");
  }

  _nextFD(path) {
    let tested = 0;
    let fd;
    while (tested < FD_MAX) {
      let candidate = this.nextFD++;
      if (candidate >= FD_MAX) {
        this.nextFD = 1;
        candidate = this.nextFD++;
      }
      if (!this.openFDs.has(candidate)) {
        fd = candidate;
        break;
      }
    }
    if (!fd) {
      throw new FSError('EMFILE', path, 'no available file descriptor');
    }
    return fd;
  }

  openSync(filePath, flags, mode) {
    flags = parseOpenFlags(flags);
    if (flags & CONSTANTS.O_NOFOLLOW && this.symlinks.has(filePath)) {
      throw new FSError('ELOOP', filePath, 'is a symlink');
    }

    filePath = this._normalizePath(filePath);

    let file = this.files.get(filePath);
    if (flags & CONSTANTS.O_CREAT) {
      if (file) {
        if (flags & CONSTANTS.O_EXCL) {
          throw new FSError('EEXIST', filePath, 'already exists');
        }
      } else {
        file = new File(makeShared(''), mode);
        this.files.set(filePath, file);
      }
    }
    if (!file) {
      throw new FSError('ENOENT', filePath, 'does not exist');
    } else if (flags & CONSTANTS.O_TRUNC) {
      file.write(makeShared(''), file.mode);
    }

    if (flags & CONSTANTS.O_APPEND) {
      throw new Error("append isn't supported");
    }

    let fd = this._nextFD(filePath);
    this.openFDs.set(fd, {filePath, file, position: 0});
    return fd;
  }
  readSync(fdNum, buffer, offset, length, position) {
    if (length == null) {
      ({offset, length, position} = offset);
    }
    if (!this.openFDs.has(fdNum)) {
      throw new Error('invalid fd');
    }
    let fd = this.openFDs.get(fdNum);
    let file = fd.file;
    position = position ?? fd.position;
    offset = offset ?? 0;
    length = length ?? buffer.length;
    length = Math.max(Math.min(length, file.buffer.length - position), 0);

    for (let i = 0; i < length; i++) {
      buffer[offset] = file.buffer[position];
      offset++;
      position++;
    }
    fd.position = position;

    return length;
  }
  writeSync(fdNum, buffer, offset, length, position) {
    if (offset != null && length == null) {
      ({offset, length, position} = offset);
    }
    if (typeof buffer === 'string') {
      buffer = Buffer.from(buffer);
    }
    if (!this.openFDs.has(fdNum)) {
      throw new Error('invalid fd');
    }
    let fd = this.openFDs.get(fdNum);
    let file = fd.file;
    position = position ?? fd.position;
    offset = offset ?? 0;
    length = length ?? buffer.length;

    let missingSize = length + position - file.buffer.length;
    if (missingSize > 0) {
      file.buffer = Buffer.concat([file.buffer, Buffer.alloc(missingSize)]);
    }

    for (let i = 0; i < length; i++) {
      file.buffer[position] = buffer[offset];
      offset++;
      position++;
    }
    fd.position = position;

    return length;
  }
  closeSync(fd) {
    if (!this.openFDs.has(fd)) {
      throw new Error('invalid fd');
    }
    this.openFDs.delete(fd);
  }
  fstatSync(fd) {
    if (!this.openFDs.has(fd)) {
      throw new Error('invalid fd');
    }
    let {filePath} = this.openFDs.get(fd);
    return this.statSync(filePath);
  }
  // ------------------------------------------------------------

  open(...args) {
    // eslint-disable-next-line
    return asyncToNode(args, 2, async (...p) =>
      Promise.resolve(this.openSync(...p)),
    );
  }
  read(...args) {
    // eslint-disable-next-line
    return asyncToNode(args, 6, async (...p) =>
      Promise.resolve(this.readSync(...p)),
    );
  }
  write(...args) {
    // eslint-disable-next-line
    return asyncToNode(args, 6, async (...p) =>
      Promise.resolve(this.writeSync(...p)),
    );
  }
  close(...args) {
    // eslint-disable-next-line
    return asyncToNode(args, 2, async (...p) =>
      Promise.resolve(this.closeSync(...p)),
    );
  }
  fstat(...args) {
    // eslint-disable-next-line
    return asyncToNode(args, 2, async (...p) =>
      Promise.resolve(this.fstatSync(...p)),
    );
  }

  rename(...args) {
    // eslint-disable-next-line
    return asyncToNode(args, 2, async (...p) =>
      Promise.resolve(this.renameSync(...p)),
    );
  }

  chmod(...args) {
    // eslint-disable-next-line
    return asyncToNode(args, 3, async (...p) =>
      Promise.resolve(this.chmodSync(...p)),
    );
  }
}

registerSerializableClass(
  `${packageJSON.version}:ExtendedMemoryFS`,
  ExtendedMemoryFS,
);

// (async () => {
// 	let fs = new ExtendedMemoryFS();
// 	await fs.mkdir("/app");
// 	await fs.writeFile("/app/x.txt", "abcdefghijklmnopqrstuvwxyz");
// 	// console.log(await fs.readdir("/app"));
// 	// console.log(fs.readFileSync("/app/x.txt", "utf8"));

// 	let fd = fs.openSync("/app/x.txt", "w");
// 	// let buf = Buffer.alloc(10);
// 	// let buf = new Uint8Array(Buffer.alloc(10));
// 	// fs.readSync(fd, buf, { length: 3 });
// 	// fs.readSync(fd, buf, { offset: 3, length: 3 });
// 	// fs.readSync(fd, buf, 0, 10, null);
// 	// console.log("b", buf.toString("utf8"));

// 	// let buf = Buffer.from("new data");
// 	// fs.writeSync(fd, buf, { position: 3 });
// 	fs.closeSync(fd);

// 	// console.log(fs.readFileSync("/app/x.txt"));
// 	// console.log(fs.readFileSync("/app/x.txt", "utf8"));
// })();

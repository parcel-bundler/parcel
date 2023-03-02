// @flow

import type {
  FileOptions,
  Encoding,
  ReaddirOptions,
  FileSystem,
  Dirent,
} from './types';
import type {FilePath} from '@parcel/types';
import type WorkerFarm from '@parcel/workers';

import {registerSerializableClass} from '@parcel/core';
import packageJSON from '../package.json';
import {MemoryFS} from './MemoryFS';
import {OverlayFS} from './OverlayFS';

import nullthrows from 'nullthrows';
import path from 'path';

// An OverlayFS with added delete tracking and copy-on-write behavior.
// $FlowFixMe[incompatible-variance]
export class CopyOnWriteToMemoryFS extends OverlayFS {
  deleted: Set<FilePath>;
  // $FlowFixMe[incompatible-extend]
  writable: MemoryFS;

  constructor(
    workerFarmOrMemoryFS: WorkerFarm | MemoryFS,
    sourceFS: FileSystem,
  ) {
    if (workerFarmOrMemoryFS instanceof MemoryFS) {
      super(workerFarmOrMemoryFS, sourceFS);
    } else {
      super(new MemoryFS(workerFarmOrMemoryFS), sourceFS);
    }

    // Because many methods on `OverlayFS` are defined as instance fields
    // (`method = () => { ... }` instead of `method() { ... }`),
    // any method overrides defined by this class will always be clobbered
    // by the super class constructor defining them directly on `this`.
    // So, we move these instance fields to the prototype chain to allow
    // overrides (and `super`) to work.
    let proto = Object.getPrototypeOf(this);
    let superproto = Object.create(Object.getPrototypeOf(proto));
    for (let name of Object.getOwnPropertyNames(this)) {
      if (proto.hasOwnProperty(name)) {
        // $FlowFixMe[prop-missing]
        superproto[name] = this[name];
        // $FlowFixMe[prop-missing]
        delete this[name];
      }
    }
    Object.setPrototypeOf(proto, superproto);

    this.deleted = new Set();
    this.chdir(sourceFS.cwd());
  }

  static deserialize(opts: any): CopyOnWriteToMemoryFS {
    return new CopyOnWriteToMemoryFS(opts.writable, opts.readable);
  }

  serialize(): {|$$raw: boolean, readable: FileSystem, writable: FileSystem|} {
    return {
      $$raw: false,
      writable: this.writable,
      readable: this.readable,
    };
  }

  _deletedThrows(filePath: FilePath): FilePath {
    filePath = this._normalizePath(filePath);
    if (this.deleted.has(filePath)) {
      throw new FSError('ENOENT', filePath, 'does not exist');
    }
    return filePath;
  }

  _checkExists(filePath: FilePath): FilePath {
    filePath = this._deletedThrows(filePath);
    if (!this.existsSync(filePath)) {
      throw new FSError('ENOENT', filePath, 'does not exist');
    }
    return filePath;
  }

  _isSymlink(filePath: FilePath): boolean {
    filePath = this._normalizePath(filePath);
    // Check the parts of the path to see if any are symlinks.
    let {root, dir, base} = path.parse(filePath);
    let segments = dir.slice(root.length).split(path.sep).concat(base);
    while (segments.length) {
      filePath = path.join(root, ...segments);
      let name = segments.pop();
      if (this.deleted.has(filePath)) {
        return false;
      } else if (this.writable.symlinks.has(filePath)) {
        return true;
      } else {
        // HACK: Parcel fs does not provide `lstatSync`,
        // so we use `readdirSync` to check if the path is a symlink.
        let parent = path.resolve(filePath, '..');
        if (parent === filePath) {
          return false;
        }
        for (let dirent of this.readdirSync(parent, {withFileTypes: true})) {
          if (typeof dirent === 'string') {
            break; // {withFileTypes: true} not supported
          } else if (dirent.name === name) {
            if (dirent.isSymbolicLink()) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  _normalizePath(filePath: FilePath): FilePath {
    return path.resolve(this.cwd(), filePath);
  }

  async copyFile(from: FilePath, to: FilePath): Promise<void> {
    from = this._normalizePath(from);
    to = this._normalizePath(to);
    await super.copyFile(from, to);
    this.deleted.delete(to);
  }

  // eslint-disable-next-line require-await
  async exists(filePath: FilePath): Promise<boolean> {
    return this.existsSync(filePath);
  }

  // $FlowFixMe[method-unbinding]
  existsSync(filePath: FilePath): boolean {
    filePath = this._normalizePath(filePath);
    if (this.deleted.has(filePath)) return false;

    try {
      filePath = this.realpathSync(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (this.deleted.has(filePath)) return false;

    return (
      this.writable.existsSync(filePath) || this.readable.existsSync(filePath)
    );
  }

  // $FlowFixMe[method-unbinding]
  async mkdirp(dir: FilePath): Promise<void> {
    dir = this._normalizePath(dir);
    await super.mkdirp(dir);

    let root = path.parse(dir).root;
    while (dir !== root) {
      this.deleted.delete(dir);
      dir = path.dirname(dir);
    }
  }

  // eslint-disable-next-line require-await
  async readdir(
    dir: FilePath,
    opts?: ReaddirOptions,
  ): Promise<Array<FilePath> | Array<Dirent>> {
    return this.readdirSync(dir, opts);
  }

  readdirSync(
    dir: FilePath,
    opts?: ReaddirOptions,
  ): Array<FilePath> | Array<Dirent> {
    dir = this.realpathSync(dir);
    let entries = new Map();

    try {
      for (let entry: any of this.writable.readdirSync(dir, opts)) {
        let filePath = path.join(dir, entry.name ?? entry);
        if (this.deleted.has(filePath)) continue;
        entries.set(filePath, entry);
      }
    } catch {
      // noop
    }

    try {
      for (let entry: any of this.readable.readdirSync(dir, opts)) {
        let filePath = path.join(dir, entry.name ?? entry);
        if (this.deleted.has(filePath)) continue;
        if (entries.has(filePath)) continue;
        entries.set(filePath, entry);
      }
    } catch {
      // noop
    }

    return Array.from(entries.values());
  }

  /* eslint-disable require-await */
  // $FlowFixMe[method-unbinding]
  async readFile(
    filePath: FilePath,
    encoding: ?Encoding,
  ): // $FlowFixMe
  Promise<Buffer | string> {
    return this.readFileSync(filePath, encoding);
  }
  /* eslint-enable require-await */

  // $FlowFixMe[method-unbinding]
  readFileSync(filePath: FilePath, encoding: ?Encoding): Buffer | string {
    filePath = this.realpathSync(filePath);
    return super.readFileSync(filePath, encoding);
  }

  /* eslint-disable require-await */
  // $FlowFixMe[method-unbinding]
  async realpath(filePath: FilePath): Promise<FilePath> {
    return this.realpathSync(filePath);
  }
  /* eslint-enable require-await */

  // $FlowFixMe[method-unbinding]
  realpathSync(filePath: FilePath): FilePath {
    filePath = this._deletedThrows(filePath);
    filePath = this._deletedThrows(this.writable.realpathSync(filePath));
    if (!this.writable.existsSync(filePath)) {
      return this.readable.realpathSync(filePath);
    }
    return filePath;
  }

  // $FlowFixMe[method-unbinding]
  async rimraf(filePath: FilePath): Promise<void> {
    try {
      await this.unlink(filePath);
    } catch (e) {
      // noop
    }
  }

  /* eslint-disable require-await */
  // $FlowFixMe[method-unbinding]
  async stat(filePath: FilePath): // $FlowFixMe
  Promise<Stats> {
    return this.statSync(filePath);
  }
  /* eslint-enable require-await */

  // $FlowFixMe[method-unbinding]
  statSync(filePath: FilePath): Stats {
    filePath = this._normalizePath(filePath);
    try {
      return this.writable.statSync(filePath);
    } catch (e) {
      if (e.code === 'ENOENT' && this.existsSync(filePath)) {
        return this.readable.statSync(filePath);
      }
      throw e;
    }
  }

  // $FlowFixMe[method-unbinding]
  async symlink(target: FilePath, filePath: FilePath): Promise<void> {
    target = this._normalizePath(target);
    filePath = this._normalizePath(filePath);
    await super.symlink(target, filePath);
    this.deleted.delete(filePath);
  }

  // $FlowFixMe[method-unbinding]
  async unlink(filePath: FilePath): Promise<void> {
    filePath = this._normalizePath(filePath);

    let toDelete = [filePath];

    if (this._isSymlink(filePath)) {
      this.writable.symlinks.delete(filePath);
    } else if (this.statSync(filePath).isDirectory()) {
      let stack = [filePath];

      // Recursively add every descendant path to deleted.
      while (stack.length) {
        let root = nullthrows(stack.pop());
        for (let ent of this.readdirSync(root, {withFileTypes: true})) {
          if (typeof ent === 'string') {
            let childPath = path.join(root, ent);
            toDelete.push(childPath);
            if (this.statSync(childPath).isDir()) {
              stack.push(childPath);
            }
          } else {
            let childPath = path.join(root, ent.name);
            toDelete.push(childPath);
            if (ent.isDirectory()) {
              stack.push(childPath);
            }
          }
        }
      }
    }

    try {
      await super.unlink(filePath);
    } catch (e) {
      if (e.code === 'ENOENT' && !this.readable.existsSync(filePath)) {
        throw e;
      }
    }

    for (let pathToDelete of toDelete) {
      this.deleted.add(pathToDelete);
    }
  }

  // $FlowFixMe[method-unbinding]
  async writeFile(
    filePath: FilePath,
    contents: string | Buffer,
    options: ?FileOptions,
  ): Promise<void> {
    filePath = this._normalizePath(filePath);
    await super.writeFile(filePath, contents, options);
    this.deleted.delete(filePath);
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
    Error.captureStackTrace?.(this, this.constructor);
  }
}

registerSerializableClass(
  `${packageJSON.version}:CopyOnWriteToMemoryFS`,
  CopyOnWriteToMemoryFS,
);

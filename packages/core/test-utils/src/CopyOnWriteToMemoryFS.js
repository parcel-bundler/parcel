// @flow

import type {
  FileOptions,
  Encoding,
  ReaddirOptions,
  FileSystem,
  Dirent,
} from '@parcel/fs';
import type {FilePath} from '@parcel/types';
import type {Readable, Writable} from 'stream';

import {MemoryFS, OverlayFS} from '@parcel/fs';
import WorkerFarm from '@parcel/workers';

import path from 'path';

// An OverlayFS with added delete tracking and copy-on-write behavior.
// $FlowFixMe[incompatible-variance]
export class CopyOnWriteToMemoryFS extends OverlayFS {
  deleted: Set<FilePath>;
  // $FlowFixMe[incompatible-extend]
  writable: MemoryFS;

  constructor(workerFarm: WorkerFarm, sourceFS: FileSystem) {
    super(new MemoryFS(workerFarm), sourceFS);

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

  _normalizePath(filePath: FilePath): FilePath {
    return path.resolve(this.cwd(), filePath);
  }

  async _ensureNormalizedPath(filePath: FilePath): Promise<FilePath> {
    filePath = this._normalizePath(filePath);
    await this.mkdirp(path.dirname(filePath));
    return filePath;
  }

  async copyFile(from: FilePath, to: FilePath): Promise<void> {
    from = this._normalizePath(from);
    to = await this._ensureNormalizedPath(to);
    await super.copyFile(from, to);
    this.deleted.delete(to);
  }

  async exists(filePath: FilePath): Promise<boolean> {
    return this.existsSync(filePath);
  }

  // $FlowFixMe[method-unbinding]
  existsSync(filePath: FilePath): boolean {
    filePath = this._normalizePath(filePath);
    if (this.deleted.has(filePath)) return false;

    let dir = path.dirname(filePath);
    let root = path.parse(dir).root;

    while (dir !== root) {
      if (this.deleted.has(dir)) return false;
      dir = path.dirname(dir);
    }

    return (
      this.writable.existsSync(filePath) ||
      this.writable.symlinks.has(filePath) ||
      this.readable.existsSync(filePath)
    );
  }

  // $FlowFixMe[method-unbinding]
  async mkdirp(dir: FilePath): Promise<void> {
    dir = await this._normalizePath(dir);
    await super.mkdirp(dir);

    let root = path.parse(dir).root;
    while (dir !== root) {
      this.deleted.delete(dir);
      dir = path.dirname(dir);
    }
  }

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
    dir = this.writable.realpathSync(this._normalizePath(dir));
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

  // $FlowFixMe[method-unbinding]
  async readFile(
    filePath: FilePath,
    encoding: ?Encoding,
  ): // $FlowFixMe
  Promise<Buffer | string> {
    return this.readFileSync(filePath);
  }

  // $FlowFixMe[method-unbinding]
  readFileSync(filePath: FilePath, encoding: ?Encoding): Buffer | string {
    filePath = this._normalizePath(filePath);
    return super.readFileSync(filePath, encoding);
  }

  // $FlowFixMe[method-unbinding]
  async realpath(filePath: FilePath): Promise<FilePath> {
    return this.realpathSync(filePath);
  }

  // $FlowFixMe[method-unbinding]
  realpathSync(filePath: FilePath): FilePath {
    filePath = this.writable.realpathSync(this._normalizePath(filePath));
    return super.realpathSync(filePath);
  }

  // $FlowFixMe[method-unbinding]
  async rimraf(filePath: FilePath): Promise<void> {
    filePath = await this._normalizePath(filePath);

    await super.rimraf(filePath);

    // Clean up redundant deleted paths.
    for (let deletedPath of this.deleted) {
      if (deletedPath.startsWith(filePath)) {
        this.deleted.delete(deletedPath);
      }
    }

    this.deleted.add(filePath);
  }

  // $FlowFixMe[method-unbinding]
  async stat(filePath: FilePath): // $FlowFixMe
  Promise<Stats> {
    return this.statSync(filePath);
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
    filePath = await this._normalizePath(filePath);
    await super.unlink(filePath);
    this.deleted.add(filePath);
  }

  // $FlowFixMe[method-unbinding]
  async writeFile(
    filePath: FilePath,
    contents: string | Buffer,
    options: ?FileOptions,
  ): Promise<void> {
    filePath = await this._ensureNormalizedPath(filePath);
    await super.writeFile(filePath, contents, options);
    this.deleted.delete(filePath);
  }
}

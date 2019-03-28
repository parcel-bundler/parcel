// @flow strict-local

import type {FilePath} from '@parcel/types';
import type {FSWatcherOptions} from 'chokidar';

import {jsonToError} from '@parcel/utils/src/errorUtils';
import {fork, type ChildProcess} from 'child_process';
import EventEmitter from 'events';
import nullthrows from 'nullthrows';
import Path from 'path';

import {encodeOptions, type EncodedFSWatcherOptions} from './options';

/**
 * This watcher wraps chokidar so that we watch directories rather than individual files on macOS.
 * This prevents us from hitting EMFILE errors when running out of file descriptors.
 * Chokidar does not have support for watching directories on non-macOS platforms, so we disable
 * this behavior in order to prevent watching more individual files than necessary (e.g. node_modules).
 */
export default class Watcher extends EventEmitter {
  child: ?ChildProcess = null;
  options: EncodedFSWatcherOptions;
  ready: boolean = false;
  readyQueue: Array<() => mixed> = [];
  shouldWatchDirs: boolean = false;
  stopped: boolean = false;
  watchedDirectories: Map<FilePath, number> = new Map();
  watchedPaths: Set<FilePath> = new Set();

  constructor(
    options: FSWatcherOptions = {
      // FS events on macOS are flakey in the tests, which write lots of files very quickly
      // See https://github.com/paulmillr/chokidar/issues/612
      useFsEvents:
        process.platform === 'darwin' && process.env.NODE_ENV !== 'test',
      ignoreInitial: true,
      ignorePermissionErrors: true,
      ignored: /\.cache|\.git/
    }
  ) {
    super();
    this.options = encodeOptions(options);

    this.on('ready', () => {
      this.ready = true;
      for (let func of this.readyQueue) {
        func();
      }
      this.readyQueue = [];
    });

    this.startchild();
  }

  startchild(): void {
    if (this.child) return;

    let filteredArgs = process.execArgv.filter(
      v => !/^--(debug|inspect)/.test(v)
    );

    let options = {
      execArgv: filteredArgs,
      env: process.env,
      cwd: process.cwd()
    };

    let child = (this.child = fork(
      Path.join(__dirname, 'child'),
      process.argv,
      options
    ));

    if (this.watchedPaths.size > 0) {
      this.sendCommand('add', [Array.from(this.watchedPaths)]);
    }

    child.send({
      type: 'init',
      options: this.options
    });

    child.on('message', msg => this.handleEmit(msg.event, msg.data));
    child.on('error', () => {});
    child.on('exit', () => this.handleClosed());
    // child.on('close', () => this.handleClosed());
  }

  handleClosed(): void {
    if (!this.stopped) {
      // Restart the child
      this.child = null;
      this.ready = false;
      this.startchild();
    }

    this.emit('childDead');
  }

  // $FlowFixMe
  handleEmit(event: string, data: any): void {
    if (event === 'watcherError') {
      this.emit(event, jsonToError(data));
      return;
    }

    if (event === 'all') {
      this.emit(event, data.action, data.path);
    } else {
      this.emit(event, data);
    }
  }

  sendCommand(func: string, args: Array<mixed>): void {
    if (!this.ready) {
      this.readyQueue.push(() => this.sendCommand(func, args));
      return;
    }

    nullthrows(this.child).send({
      type: 'function',
      name: func,
      args: args
    });
  }

  _addPath(path: FilePath): boolean {
    if (!this.watchedPaths.has(path)) {
      this.watchedPaths.add(path);
      return true;
    }
    return false;
  }

  add(paths: FilePath | Array<FilePath>): void {
    let added = false;
    if (Array.isArray(paths)) {
      for (let path of paths) {
        added = !added ? this._addPath(path) : true;
      }
    } else {
      added = this._addPath(paths);
    }
    if (added) this.sendCommand('add', [paths]);
  }

  _closePath(path: FilePath): void {
    if (this.watchedPaths.has(path)) {
      this.watchedPaths.delete(path);
    }
    this.sendCommand('_closePath', [path]);
  }

  _emulateChildDead(): void {
    if (!this.child) {
      return;
    }

    this.child.send({
      type: 'die'
    });
  }

  _emulateChildError(): void {
    if (!this.child) {
      return;
    }

    this.child.send({
      type: 'emulate_error'
    });
  }

  getWatched(): {[string]: []} {
    let watchList = {};
    for (let path of this.watchedPaths) {
      let key =
        this.options.cwd == null ? path : Path.relative(this.options.cwd, path);
      watchList[key || '.'] = [];
    }
    return watchList;
  }

  /**
   * Find a parent directory of `path` which is already watched
   */
  getWatchedParent(path: FilePath): ?FilePath {
    let curDir = Path.dirname(path);

    let root = Path.parse(curDir).root;
    while (curDir !== root) {
      if (this.watchedDirectories.has(curDir)) {
        return curDir;
      }

      curDir = Path.dirname(curDir);
    }

    return null;
  }

  /**
   * Find a list of child directories of `path` which are already watched
   */
  getWatchedChildren(path: FilePath) {
    let curDir = Path.dirname(path) + Path.sep;

    let res = [];
    for (let dir of this.watchedDirectories.keys()) {
      if (dir.startsWith(curDir)) {
        res.push(dir);
      }
    }

    return res;
  }

  /**
   * Add a path to the watcher
   */
  watch(path: FilePath) {
    if (this.shouldWatchDirs) {
      // If there is no parent directory already watching this path, add a new watcher.
      let parent = this.getWatchedParent(path);
      if (parent == null) {
        // Find watchers on child directories, and remove them. They will be handled by the new parent watcher.
        let children = this.getWatchedChildren(path);
        let count = 1;

        for (let dir of children) {
          count += this.watchedDirectories.get(dir);
          this._closePath(dir);
          this.watchedDirectories.delete(dir);
        }

        let dir = Path.dirname(path);
        this.add(dir);
        this.watchedDirectories.set(dir, count);
      } else {
        // Otherwise, increment the reference count of the parent watcher.
        this.watchedDirectories.set(
          parent,
          this.watchedDirectories.get(parent) + 1
        );
      }
    } else {
      this.add(path);
    }
  }

  _unwatch(paths: FilePath | Array<FilePath>) {
    let removed = false;
    if (Array.isArray(paths)) {
      for (let p of paths) {
        removed = !removed ? this.watchedPaths.delete(p) : true;
      }
    } else {
      removed = this.watchedPaths.delete(paths);
    }
    if (removed) this.sendCommand('unwatch', [paths]);
  }

  /**
   * Remove a path from the watcher
   */
  unwatch(path: FilePath): void {
    if (this.shouldWatchDirs) {
      let dir = this.getWatchedParent(path);
      if (dir != null) {
        // When the count of files watching a directory reaches zero, unwatch it.
        let count = nullthrows(this.watchedDirectories.get(dir)) - 1;
        if (count === 0) {
          this.watchedDirectories.delete(dir);
          this._unwatch(dir);
        } else {
          this.watchedDirectories.set(dir, count);
        }
      }
    } else {
      this._unwatch(path);
    }
  }

  /**
   * Stop watching all paths
   */
  async stop(): Promise<void> {
    this.stopped = true;

    if (this.child) {
      this.child.kill();

      return new Promise(resolve => this.once('childDead', resolve));
    }
  }
}

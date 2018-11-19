const fork = require('child_process').fork;
const optionsTransfer = require('./options');
const Path = require('path');
const {EventEmitter} = require('events');
const {errorUtils} = require('@parcel/utils');

/**
 * This watcher wraps chokidar so that we watch directories rather than individual files on macOS.
 * This prevents us from hitting EMFILE errors when running out of file descriptors.
 * Chokidar does not have support for watching directories on non-macOS platforms, so we disable
 * this behavior in order to prevent watching more individual files than necessary (e.g. node_modules).
 */
class Watcher extends EventEmitter {
  constructor(
    options = {
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
    this.options = optionsTransfer.encode(options);
    this.watchedPaths = new Set();
    this.child = null;
    this.ready = false;
    this.readyQueue = [];
    this.watchedDirectories = new Map();
    this.stopped = false;

    this.on('ready', () => {
      this.ready = true;
      for (let func of this.readyQueue) {
        func();
      }
      this.readyQueue = [];
    });

    this.startchild();
  }

  startchild() {
    if (this.child) return;

    let filteredArgs = process.execArgv.filter(
      v => !/^--(debug|inspect)/.test(v)
    );

    let options = {
      execArgv: filteredArgs,
      env: process.env,
      cwd: process.cwd()
    };

    this.child = fork(Path.join(__dirname, 'child'), process.argv, options);

    if (this.watchedPaths.size > 0) {
      this.sendCommand('add', [Array.from(this.watchedPaths)]);
    }

    this.child.send({
      type: 'init',
      options: this.options
    });

    this.child.on('message', msg => this.handleEmit(msg.event, msg.path));
    this.child.on('error', () => {});
    this.child.on('exit', () => this.handleClosed());
    // this.child.on('close', () => this.handleClosed());
  }

  handleClosed() {
    if (!this.stopped) {
      // Restart the child
      this.child = null;
      this.ready = false;
      this.startchild();
    }

    this.emit('childDead');
  }

  handleEmit(event, data) {
    if (event === 'watcherError') {
      data = errorUtils.jsonToError(data);
    }

    this.emit(event, data);
  }

  sendCommand(func, args) {
    if (!this.ready) {
      return this.readyQueue.push(() => this.sendCommand(func, args));
    }

    this.child.send({
      type: 'function',
      name: func,
      args: args
    });
  }

  _addPath(path) {
    if (!this.watchedPaths.has(path)) {
      this.watchedPaths.add(path);
      return true;
    }
  }

  add(paths) {
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

  _closePath(path) {
    if (this.watchedPaths.has(path)) {
      this.watchedPaths.delete(path);
    }
    this.sendCommand('_closePath', [path]);
  }

  _emulateChildDead() {
    if (!this.child) {
      return;
    }

    this.child.send({
      type: 'die'
    });
  }

  _emulateChildError() {
    if (!this.child) {
      return;
    }

    this.child.send({
      type: 'emulate_error'
    });
  }

  getWatched() {
    let watchList = {};
    for (let path of this.watchedPaths) {
      let key = this.options.cwd ? Path.relative(this.options.cwd, path) : path;
      watchList[key || '.'] = [];
    }
    return watchList;
  }

  /**
   * Find a parent directory of `path` which is already watched
   */
  getWatchedParent(path) {
    path = Path.dirname(path);

    let root = Path.parse(path).root;
    while (path !== root) {
      if (this.watchedDirectories.has(path)) {
        return path;
      }

      path = Path.dirname(path);
    }

    return null;
  }

  /**
   * Find a list of child directories of `path` which are already watched
   */
  getWatchedChildren(path) {
    path = Path.dirname(path) + Path.sep;

    let res = [];
    for (let dir of this.watchedDirectories.keys()) {
      if (dir.startsWith(path)) {
        res.push(dir);
      }
    }

    return res;
  }

  /**
   * Add a path to the watcher
   */
  watch(path) {
    if (this.shouldWatchDirs) {
      // If there is no parent directory already watching this path, add a new watcher.
      let parent = this.getWatchedParent(path);
      if (!parent) {
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

  _unwatch(paths) {
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
  unwatch(path) {
    if (this.shouldWatchDirs) {
      let dir = this.getWatchedParent(path);
      if (dir) {
        // When the count of files watching a directory reaches zero, unwatch it.
        let count = this.watchedDirectories.get(dir) - 1;
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
  async stop() {
    this.stopped = true;

    if (this.child) {
      this.child.kill();

      return new Promise(resolve => this.once('childDead', resolve));
    }
  }
}

module.exports = Watcher;

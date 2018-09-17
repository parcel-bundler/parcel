const FSWatcher = require('fswatcher-child');
const Path = require('path');

/**
 * This watcher wraps chokidar so that we watch directories rather than individual files on macOS.
 * This prevents us from hitting EMFILE errors when running out of file descriptors.
 * Chokidar does not have support for watching directories on non-macOS platforms, so we disable
 * this behavior in order to prevent watching more individual files than necessary (e.g. node_modules).
 */
class Watcher {
  constructor() {
    // FS events on macOS are flakey in the tests, which write lots of files very quickly
    // See https://github.com/paulmillr/chokidar/issues/612
    this.shouldWatchDirs =
      process.platform === 'darwin' && process.env.NODE_ENV !== 'test';
    this.watcher = new FSWatcher({
      useFsEvents: this.shouldWatchDirs,
      ignoreInitial: true,
      ignorePermissionErrors: true,
      ignored: /\.cache|\.git/
    });

    this.watchedDirectories = new Map();
    this.stopped = false;
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
          this.watcher._closePath(dir);
          this.watchedDirectories.delete(dir);
        }

        let dir = Path.dirname(path);
        this.watcher.add(dir);
        this.watchedDirectories.set(dir, count);
      } else {
        // Otherwise, increment the reference count of the parent watcher.
        this.watchedDirectories.set(
          parent,
          this.watchedDirectories.get(parent) + 1
        );
      }
    } else {
      this.watcher.add(path);
    }
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
          this.watcher.unwatch(dir);
        } else {
          this.watchedDirectories.set(dir, count);
        }
      }
    } else {
      this.watcher.unwatch(path);
    }
  }

  /**
   * Add an event handler
   */
  on(event, callback) {
    this.watcher.on(event, callback);
  }

  /**
   * Add an event handler
   */
  once(event, callback) {
    this.watcher.once(event, callback);
  }

  /**
   * Stop watching all paths
   */
  async stop() {
    this.stopped = true;
    await this.watcher.close();
  }
}

module.exports = Watcher;

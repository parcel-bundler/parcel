const Watcher = require('../src/Watcher');
const path = require('path');
const assert = require('assert');

describe('fs watcher', function() {
  it('getWatchedChildren', async function() {
    let watcher = new Watcher({
      shouldWatchDirs: true
    });

    watcher.watch(path.join(__dirname, 'fs.js'));
    watcher.watch(path.join(__dirname, 'integration/fs/index.js'));
    watcher.watch(path.join(__dirname, 'integration/fs/test.txt'));

    assert.deepEqual(watcher.getWatchedChildren(path.join(__dirname)), [
      __dirname
    ]);
  });

  it('getWatchedParent', async function() {
    let watcher = new Watcher({
      shouldWatchDirs: true
    });

    watcher.watch(path.join(__dirname, 'fs.js'));
    watcher.watch(path.join(__dirname, 'integration/fs/index.js'));
    watcher.watch(path.join(__dirname, 'integration/fs/test.txt'));

    assert.deepEqual(
      watcher.getWatchedParent(path.join(__dirname, 'integration/fs/')),
      __dirname
    );
  });

  it('watching and unwatching all should fill and empty watched ', async function() {
    let watcher = new Watcher({
      shouldWatchDirs: true
    });

    let paths = [
      path.join(__dirname, 'fs.js'),
      path.join(__dirname, 'integration/fs/index.js'),
      path.join(__dirname, 'integration/fs/test.txt')
    ];

    for (let filePath of paths) {
      watcher.watch(filePath);
    }
    assert.deepEqual(watcher.getWatchedChildren(path.join(__dirname)), [
      __dirname
    ]);
    assert.equal(watcher.watchedDirectories.get(__dirname), 3);

    for (let filePath of paths) {
      watcher.unwatch(filePath);
    }
    assert.equal(watcher.watchedDirectories.get(__dirname), undefined);
    assert.deepEqual(watcher.getWatchedChildren(path.join(__dirname)), []);
  });
});

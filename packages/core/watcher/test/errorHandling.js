const Watcher = require('../index');
const fs = require('@parcel/fs');
const path = require('path');
const assert = require('assert');

describe('error handling', function() {
  let tmpFolder = path.join(__dirname, './tmp/');

  before(async () => {
    await fs.mkdirp(tmpFolder);
  });

  it('Should restart child process if it dies', async () => {
    let filepath = path.join(tmpFolder, 'file1.txt');
    await fs.writeFile(filepath, 'this is a text document');

    let watcher = new Watcher({});
    watcher.add(filepath);
    await new Promise(resolve => watcher.once('ready', resolve));

    watcher._emulateChildDead();
    await new Promise(resolve => watcher.once('_chokidarReady', resolve));

    let changePromise = new Promise(resolve => watcher.once('change', resolve));
    await fs.writeFile(filepath, 'this is not a text document');
    // if this doesn't happen, the test will time out and fail.
    await changePromise;

    await watcher.stop();
  });

  it('Should restart child process on errors', async () => {
    let filepath = path.join(tmpFolder, 'file1.txt');
    await fs.writeFile(filepath, 'this is a text document');

    let watcher = new Watcher({});
    watcher.add(filepath);

    let hasThrown = false;
    watcher.on('watcherError', () => (hasThrown = true));

    await new Promise(resolve => watcher.once('ready', resolve));

    watcher._emulateChildError();
    await new Promise(resolve => watcher.once('_chokidarReady', resolve));

    let changePromise = new Promise(resolve => watcher.once('change', resolve));
    await fs.writeFile(filepath, 'this is not a text document');
    await changePromise;

    await watcher.stop();
    assert(hasThrown, 'Should have emitted an error event.');
  });
});

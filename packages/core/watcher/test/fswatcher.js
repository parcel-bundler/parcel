const FSWatcher = require('../index');
const {sleep} = require('@parcel/test-utils');
const assert = require('assert');

describe('Watcher', function() {
  it('Should be able to create a new watcher', async () => {
    let watcher = new FSWatcher();

    assert(!!watcher.child);
    assert(!watcher.ready);

    await sleep(1000);

    assert(!!watcher.child);
    assert(watcher.ready);

    await watcher.stop();
  });

  it('Should be able to properly destroy the watcher', async () => {
    let watcher = new FSWatcher();

    await sleep(1000);

    assert(!!watcher.child);
    assert(watcher.ready);

    let time = Date.now();
    await watcher.stop();
    assert.notEqual(time, Date.now());
  });
});

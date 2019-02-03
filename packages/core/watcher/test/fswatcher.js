const Watcher = require('../index');
const {sleep} = require('@parcel/test-utils');
const assert = require('assert');

describe('Watcher', function() {
  it('Should be able to create a new watcher', async () => {
    let watcher = new Watcher();

    assert(!!watcher.child);
    assert(!watcher.ready);

    await sleep(1000);

    assert(!!watcher.child);
    assert(watcher.ready);

    await watcher.stop();
  });

  it('Should be able to properly destroy the watcher', async () => {
    let watcher = new Watcher();

    await sleep(1000);

    assert(!!watcher.child);
    assert(watcher.ready);

    await watcher.stop();
    assert(watcher.child.killed);
  });
});

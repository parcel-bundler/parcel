// @flow

import Watcher from '../';
import assert from 'assert';

// For flow
const invariant = assert;

describe('Watcher', function() {
  it('Should be able to create a new watcher', async () => {
    let watcher = new Watcher();

    assert(watcher.child);
    assert(!watcher.ready);

    await new Promise(resolve => watcher.once('ready', resolve));

    assert(watcher.child);
    assert(watcher.ready);

    await watcher.stop();
  });

  it('Cleans up the related child process', async () => {
    let watcher = new Watcher();
    await new Promise(resolve => watcher.once('ready', resolve));

    assert(watcher.child != null);
    assert(watcher.ready);

    await watcher.stop();
    invariant(watcher.child != null);
    assert(watcher.child.killed);
  });
});

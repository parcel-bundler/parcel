const Watcher = require('../index');
const assert = require('assert');

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

    assert(watcher.child);
    assert(watcher.ready);

    let childDeadPromise = new Promise(resolve =>
      watcher.once('childDead', resolve)
    );
    await watcher.stop();
    await childDeadPromise;
  });
});

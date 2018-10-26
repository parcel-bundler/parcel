const Watcher = require('../index');
const fs = require('@parcel/fs');
const path = require('path');
const assert = require('assert');
const {sleep} = require('@parcel/test-utils');

describe('change event', function() {
  let tmpFolder = path.join(__dirname, './tmp/');

  before(() => {
    fs.mkdirp(tmpFolder);
  });

  it('Should emit event on filechange', async () => {
    let watcher = new Watcher({});

    let filepath = path.join(tmpFolder, 'file1.txt');

    await fs.writeFile(filepath, 'this is a text document');

    watcher.add(filepath);

    let changed = false;
    watcher.once('change', () => {
      changed = true;
    });

    if (!watcher.ready) {
      await new Promise(resolve => watcher.once('ready', resolve));
    }

    await sleep(250);

    await fs.writeFile(filepath, 'this is not a text document');

    await sleep(500);

    assert(changed, 'File should be flagged as changed.');

    await watcher.stop();
  });

  it('Should emit event on filechange using arrays', async () => {
    let watcher = new Watcher({});

    let filepath = path.join(tmpFolder, 'file1.txt');

    await fs.writeFile(filepath, 'this is a text document');

    watcher.add([filepath]);

    let changed = false;
    watcher.once('change', () => {
      changed = true;
    });

    if (!watcher.ready) {
      await new Promise(resolve => watcher.once('ready', resolve));
    }

    await sleep(250);

    await fs.writeFile(filepath, 'this is not a text document');

    await sleep(500);

    assert(changed, 'File should be flagged as changed.');

    await watcher.stop();
  });

  it('Should not emit event if file has been added and removed', async () => {
    let watcher = new Watcher({});

    let filepath = path.join(tmpFolder, 'file1.txt');

    await fs.writeFile(filepath, 'this is a text document');

    await sleep(250);

    watcher.add(filepath);

    let changed = false;
    watcher.once('change', () => {
      changed = true;
    });

    if (!watcher.ready) {
      await new Promise(resolve => watcher.once('ready', resolve));
    }

    await sleep(250);

    watcher.unwatch(filepath);

    await fs.writeFile(filepath, 'this is not a text document');

    await sleep(500);

    assert(!changed, 'Should not have emitted a change event.');

    await watcher.stop();
  });
});

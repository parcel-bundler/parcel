const Watcher = require('../index');
const fs = require('@parcel/fs');
const path = require('path');
const assert = require('assert');
const {sleep} = require('@parcel/test-utils');

describe('options', function() {
  let tmpFolder = path.join(__dirname, './tmp/');

  before(() => {
    fs.mkdirp(tmpFolder);
  });

  it('Should pass init options with correct ignored regex', async () => {
    let watcher = new Watcher({
      ignored: /file/
    });

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

    assert(!changed, 'File should not be flagged as changed.');

    await watcher.stop();
  });

  it('Should pass init options with a more complex ignored regex', async () => {
    let watcher = new Watcher({
      ignored: /file|config/
    });

    let filepaths = [
      path.join(tmpFolder, 'file1.txt'),
      path.join(tmpFolder, 'config.json')
    ];

    for (let filepath of filepaths) {
      await fs.writeFile(filepath, 'this is a text document');

      watcher.add(filepath);
    }

    let changed = false;
    watcher.once('change', () => {
      changed = true;
    });

    if (!watcher.ready) {
      await new Promise(resolve => watcher.once('ready', resolve));
    }

    await sleep(250);

    for (let filepath of filepaths) {
      await fs.writeFile(filepath, 'this is not a text document');

      watcher.add(filepath);
    }

    await sleep(500);

    assert(!changed, 'File should not be flagged as changed.');

    await watcher.stop();
  });

  it('Should not ignore any files outside of the regex', async () => {
    let watcher = new Watcher({
      ignored: /file|config/
    });

    let filepaths = [
      path.join(tmpFolder, 'file1.txt'),
      path.join(tmpFolder, 'config.json'),
      path.join(tmpFolder, 'something')
    ];

    for (let filepath of filepaths) {
      await fs.writeFile(filepath, 'this is a text document');

      watcher.add(filepath);
    }

    let changed = 0;
    watcher.once('change', () => {
      changed++;
    });

    if (!watcher.ready) {
      await new Promise(resolve => watcher.once('ready', resolve));
    }

    await sleep(250);

    for (let filepath of filepaths) {
      await fs.writeFile(filepath, 'this is not a text document');

      watcher.add(filepath);
    }

    await sleep(500);

    assert.equal(changed, 1, 'One file should have changed once.');

    await watcher.stop();
  });
});

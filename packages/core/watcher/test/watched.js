const Watcher = require('../index');
const fs = require('@parcel/fs');
const path = require('path');
const assert = require('assert');

describe('watched paths', function() {
  let tmpFolder = path.join(__dirname, './tmp/');

  before(() => {
    fs.mkdirp(tmpFolder);
  });

  it('Should return watched paths', async () => {
    let watcher = new Watcher({});

    let filepath = path.join(tmpFolder, 'file1.txt');
    await fs.writeFile(filepath, 'this is a text document');

    watcher.add(filepath);

    assert(
      Object.keys(watcher.getWatched())[0] === filepath,
      'getWatched should return all the watched paths.'
    );

    await watcher.stop();
  });
});

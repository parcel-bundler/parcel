// @flow

import Watcher from '../';
import * as fs from '@parcel/fs';
import path from 'path';
import assert from 'assert';

describe('watched paths', function() {
  let tmpFolder = path.join(__dirname, './tmp/');

  before(async () => {
    await fs.mkdirp(tmpFolder);
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

// @flow
import assert from 'assert';
import path from 'path';
import {
  bundle,
  distDir,
  outputFS,
  removeDistDirectory,
} from '@parcel/test-utils';

const config = path.join(__dirname, './integration/swc-transformer/.parcelrc');

describe('swc-transformer', function () {
  beforeEach(async () => {
    await removeDistDirectory();
  });
  afterEach(async () => {
    await removeDistDirectory();
  });

  it('should support building with swc', async function () {
    await bundle(
      path.join(__dirname, '/integration/swc-transformer/index.js'),
      {
        config,
        defaultConfig: config,
      },
    );

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('input file here here 13'));
    assert(file.includes('swc-transformer'));
    assert(!file.includes("console.log('HEY')"));
  });
});

import assert from 'assert';
import path from 'path';
import {bundle, outputFS, distDir} from '@parcel/test-utils';

describe('namer', function () {
  it('should determine correct entry root when building a directory', async function () {
    await bundle(path.join(__dirname, 'integration/namer-dir'));

    assert(await outputFS.exists(path.join(distDir, 'index.html')));
    assert(await outputFS.exists(path.join(distDir, 'nested/other.html')));
  });
});

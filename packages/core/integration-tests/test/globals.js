import assert from 'assert';
import path from 'path';
import {bundle, outputFS} from '@parcel/test-utils';

describe('global alias', function() {
  it('should support global alias syntax', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/global-alias/index.js'),
    );

    let index = await outputFS.readFile(
      b.getBundles().find(b => b.name.startsWith('index')).filePath,
      'utf8',
    );

    assert(/module\.exports\ =\ React/.test(index));
  });
});

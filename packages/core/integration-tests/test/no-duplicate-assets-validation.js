// @flow
import assert from 'assert';
import path from 'path';
import {bundle} from '@parcel/test-utils';

describe('nodup-validator', function () {
  it.only('should throw validation error with eslint errors', async function () {
    let didThrow = false;
    let entry = ['entry1.js', 'entry2.js'].map(entry =>
      path.join(
        __dirname,
        '/integration/no-duplicate-assets-validation/',
        entry,
      ),
    );
    try {
      await bundle(entry);
    } catch (e) {
      console.log(e.diagnostics[0]);
      assert.equal(e.name, 'BuildError');
      didThrow = true;
    }
    assert(didThrow);
  });
});

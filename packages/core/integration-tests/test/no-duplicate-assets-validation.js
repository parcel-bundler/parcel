// @flow
import assert from 'assert';
import path from 'path';
import {bundle} from '@parcel/test-utils';

describe('nodup-validator', function () {
  it('should throw validation error for duplicate specified asset', async function () {
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
      assert.equal(e.name, 'BuildError');
      didThrow = true;
    }
    assert(didThrow);
  });

  //TODO: move to cache test?
  it('should throw validation error on subsequent builds for duplicate specified assets', async function () {
    let didThrow = false;
    let entry = ['entry1.js', 'entry2.js'].map(entry =>
      path.join(
        __dirname,
        '/integration/no-duplicate-assets-validation/',
        entry,
      ),
    );
    try {
      await bundle(entry, {
        shouldDisableCache: false,
      });
    } catch (e) {
      assert.equal(e.name, 'BuildError');
      didThrow = true;
    }
    assert(didThrow);
    didThrow = false;
    try {
      await bundle(entry, {shouldDisableCache: false});
    } catch (e2) {
      assert.equal(e2.name, 'BuildError');
      didThrow = true;
    }
    assert(didThrow);
  });
});

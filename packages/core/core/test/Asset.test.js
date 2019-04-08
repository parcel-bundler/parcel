// @flow strict-local

import assert from 'assert';
import Asset from '../src/Asset';
import Environment from '../src/Environment';

describe('Asset', () => {
  it('only includes connected files once per filePath', () => {
    let asset = new Asset({
      filePath: '/foo/asset.js',
      env: new Environment(),
      type: 'js'
    });
    asset.addConnectedFile({filePath: '/foo/file', hash: 'abc'});
    asset.addConnectedFile({filePath: '/foo/file', hash: 'bcd'});
    assert.deepEqual(asset.getConnectedFiles(), [
      {
        filePath: '/foo/file',
        hash: 'bcd'
      }
    ]);
  });
});

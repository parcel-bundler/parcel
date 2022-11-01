// @flow strict-local
import type {AssetOptions} from '../src/assetUtils';

import assert from 'assert';
import {Asset, MutableAsset} from '../src/public/Asset';
import UncommittedAsset from '../src/UncommittedAsset';
import {createAsset as _createAsset} from '../src/assetUtils';
import {createEnvironment} from '../src/Environment';
import {DEFAULT_OPTIONS} from './test-utils';
import {toProjectPath} from '../src/projectPath';

function createAsset(opts: AssetOptions) {
  return _createAsset('/', opts);
}

describe('Public Asset', () => {
  let internalAsset;
  beforeEach(() => {
    internalAsset = new UncommittedAsset({
      idBase: '',
      options: DEFAULT_OPTIONS,
      value: createAsset({
        idBase: '',
        filePath: toProjectPath('/', '/does/not/exist'),
        hash: '',
        type: 'js',
        env: createEnvironment({}),
        isSource: true,
        stats: {size: 0, time: 0},
      }),
    });
  });

  it('returns the same public Asset given an internal asset', () => {
    assert.equal(new Asset(internalAsset), new Asset(internalAsset));
  });

  it('returns the same public MutableAsset given an internal asset', () => {
    assert.equal(
      new MutableAsset(internalAsset),
      new MutableAsset(internalAsset),
    );
  });
});

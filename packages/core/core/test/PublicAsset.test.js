// @flow strict-local

import assert from 'assert';
import {Asset, MutableAsset} from '../src/public/Asset';
import InternalAsset, {createAsset} from '../src/InternalAsset';
import {createEnvironment} from '../src/Environment';
import {DEFAULT_OPTIONS} from './utils';

describe('Public Asset', () => {
  let internalAsset;
  beforeEach(() => {
    internalAsset = new InternalAsset({
      options: DEFAULT_OPTIONS,
      value: createAsset({
        filePath: '/does/not/exist',
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

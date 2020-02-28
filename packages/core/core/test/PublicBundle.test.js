// @flow strict-local

import assert from 'assert';
import {Bundle, NamedBundle} from '../src/public/Bundle';
import BundleGraph from '../src/BundleGraph';
import {createEnvironment} from '../src/Environment';
import {DEFAULT_OPTIONS} from './utils';
import Graph from '../src/Graph';

describe('Public Bundle', () => {
  let internalBundle;
  let bundleGraph;
  beforeEach(() => {
    let env = createEnvironment({});
    internalBundle = {
      id: '123',
      hashReference: '@@HASH_REFERENCE_123',
      entryAssetIds: [],
      type: 'js',
      env,
      filePath: null,
      name: null,
      displayName: null,
      pipeline: null,
      isEntry: null,
      isInline: null,
      isSplittable: true,
      target: {
        env,
        distDir: '',
        name: '',
        publicUrl: '',
      },
      stats: {size: 0, time: 0},
    };

    bundleGraph = new BundleGraph({graph: new Graph()});
  });

  it('returns the same public Bundle given an internal bundle', () => {
    assert.equal(
      new Bundle(internalBundle, bundleGraph, DEFAULT_OPTIONS),
      new Bundle(internalBundle, bundleGraph, DEFAULT_OPTIONS),
    );
  });

  it('returns the same public NamedBundle given an internal bundle', () => {
    assert.equal(
      new NamedBundle(internalBundle, bundleGraph, DEFAULT_OPTIONS),
      new NamedBundle(internalBundle, bundleGraph, DEFAULT_OPTIONS),
    );
  });
});

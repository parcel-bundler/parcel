// @flow strict-local
import type {Bundle as InternalBundle} from '../src/types';

import assert from 'assert';
import {ContentGraph} from '@parcel/graph';
import {Target} from '@parcel/rust';

import {Bundle, NamedBundle, PackagedBundle} from '../src/public/Bundle';
import BundleGraph from '../src/BundleGraph';
import {createEnvironment} from '../src/Environment';
import {DB, DEFAULT_OPTIONS} from './test-utils';

describe('Public Bundle', () => {
  let internalBundle: InternalBundle;
  let bundleGraph;
  let scope = {};
  beforeEach(() => {
    let env = createEnvironment(DB, {});
    internalBundle = {
      id: '123',
      hashReference: '@@HASH_REFERENCE_123',
      entryAssetIds: [],
      mainEntryId: null,
      type: 'js',
      env,
      name: null,
      displayName: null,
      publicId: null,
      pipeline: null,
      needsStableName: null,
      bundleBehavior: null,
      isSplittable: true,
      target: new Target(DB).addr,
    };

    bundleGraph = new BundleGraph(DB, {
      graph: new ContentGraph(),
      assetPublicIds: new Set(),
      publicIdByAssetId: new Map(),
      bundleContentHashes: new Map(),
    });
  });

  it('returns the same public Bundle given an internal bundle', () => {
    assert.equal(
      Bundle.get(internalBundle, bundleGraph, DEFAULT_OPTIONS, scope),
      Bundle.get(internalBundle, bundleGraph, DEFAULT_OPTIONS, scope),
    );
  });

  it('returns the same public NamedBundle given an internal bundle', () => {
    assert.equal(
      NamedBundle.get(internalBundle, bundleGraph, DEFAULT_OPTIONS, scope),
      NamedBundle.get(internalBundle, bundleGraph, DEFAULT_OPTIONS, scope),
    );
  });

  it('returns the same public PackagedBundle given an internal bundle', () => {
    assert.equal(
      PackagedBundle.get(internalBundle, bundleGraph, DEFAULT_OPTIONS, scope),
      PackagedBundle.get(internalBundle, bundleGraph, DEFAULT_OPTIONS, scope),
    );
  });
});

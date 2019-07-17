// @flow strict-local

import assert from 'assert';
import Asset from '../src/Asset';
import Environment from '../src/Environment';
import Cache, {createCacheDir} from '@parcel/cache';
// $FlowFixMe this is untyped
import tempy from 'tempy';
import {inputFS as fs, outputFS} from '@parcel/test-utils';

const stats = {time: 0, size: 0};

let cacheDir = tempy.directory();
createCacheDir(outputFS, cacheDir);
let cache = new Cache(outputFS, cacheDir);

describe('Asset', () => {
  it('only includes connected files once per filePath', () => {
    let asset = new Asset({
      fs,
      filePath: '/foo/asset.js',
      cache,
      env: new Environment(),
      stats,
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

  it('only includes dependencies once per id', () => {
    let asset = new Asset({
      fs,
      filePath: '/foo/asset.js',
      cache,
      env: new Environment(),
      stats,
      type: 'js'
    });

    asset.addDependency({moduleSpecifier: './foo'});
    asset.addDependency({moduleSpecifier: './foo'});
    let dependencies = asset.getDependencies();
    assert(dependencies.length === 1);
    assert(dependencies[0].moduleSpecifier === './foo');
  });

  it('includes different dependencies if their id differs', () => {
    let asset = new Asset({
      fs,
      filePath: '/foo/asset.js',
      cache,
      env: new Environment(),
      stats,
      type: 'js'
    });

    asset.addDependency({moduleSpecifier: './foo'});
    asset.addDependency({
      moduleSpecifier: './foo',
      env: {context: 'web-worker', engines: {}}
    });
    let dependencies = asset.getDependencies();
    assert(dependencies.length === 2);
  });
});

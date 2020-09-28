// @flow strict-local

import assert from 'assert';
import UncommittedAsset from '../src/UncommittedAsset';
import {createAsset} from '../src/assetUtils';
import {createEnvironment} from '../src/Environment';
import {DEFAULT_OPTIONS} from './test-utils';

const stats = {time: 0, size: 0};

describe('InternalAsset', () => {
  it('only includes connected files once per filePath', () => {
    let asset = new UncommittedAsset({
      value: createAsset({
        filePath: '/foo/asset.js',
        env: createEnvironment(),
        stats,
        type: 'js',
        isSource: true,
      }),
      options: DEFAULT_OPTIONS,
    });
    asset.addIncludedFile('/foo/file');
    asset.addIncludedFile('/foo/file');
    assert.deepEqual(asset.getInvalidations(), [
      {
        type: 'file',
        filePath: '/foo/file',
      },
    ]);
  });

  it('only includes dependencies once per id', () => {
    let asset = new UncommittedAsset({
      value: createAsset({
        filePath: '/foo/asset.js',
        env: createEnvironment(),
        stats,
        type: 'js',
        isSource: true,
      }),
      options: DEFAULT_OPTIONS,
    });

    asset.addDependency({moduleSpecifier: './foo'});
    asset.addDependency({moduleSpecifier: './foo'});
    let dependencies = asset.getDependencies();
    assert(dependencies.length === 1);
    assert(dependencies[0].moduleSpecifier === './foo');
  });

  it('includes different dependencies if their id differs', () => {
    let asset = new UncommittedAsset({
      value: createAsset({
        filePath: '/foo/asset.js',
        env: createEnvironment(),
        stats,
        type: 'js',
        isSource: true,
      }),
      options: DEFAULT_OPTIONS,
    });

    asset.addDependency({moduleSpecifier: './foo'});
    asset.addDependency({
      moduleSpecifier: './foo',
      env: {context: 'web-worker', engines: {}},
    });
    let dependencies = asset.getDependencies();
    assert(dependencies.length === 2);
  });
});

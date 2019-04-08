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

  it('only includes dependencies once per id', () => {
    let asset = new Asset({
      filePath: '/foo/asset.js',
      env: new Environment(),
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
      filePath: '/foo/asset.js',
      env: new Environment(),
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

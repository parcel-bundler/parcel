import assert from 'assert';
import path from 'path';
import {bundle, inputFS, outputFS} from '@parcel/test-utils';

describe('hasbang', function () {
  it('should preserve hashbangs in bundles and preserve executable file mode', async () => {
    let fixturePath = path.join(__dirname, '/integration/node_hashbang');
    await bundle(path.join(fixturePath, 'main.js'));

    let mainPath = path.join(fixturePath, 'dist', 'node', 'main.js');
    let main = await outputFS.readFile(mainPath, 'utf8');
    assert.equal(main.lastIndexOf('#!/usr/bin/env node\n'), 0);
    assert.equal(
      (await outputFS.stat(mainPath)).mode,
      (await inputFS.stat(path.join(fixturePath, 'main.js'))).mode,
    );
    await outputFS.rimraf(path.join(fixturePath, 'dist'));
  });

  it('should not preserve hashbangs in browser bundles', async () => {
    let fixturePath = path.join(__dirname, '/integration/node_hashbang');
    await bundle(path.join(fixturePath, 'main.js'));

    let main = await outputFS.readFile(
      path.join(fixturePath, 'dist', 'browser', 'main.js'),
      'utf8',
    );
    assert(!main.includes('#!/usr/bin/env node\n'));
    await outputFS.rimraf(path.join(fixturePath, 'dist'));
  });

  it('should preserve hashbangs in scopehoisted bundles', async () => {
    let fixturePath = path.join(__dirname, '/integration/node_hashbang');
    await bundle(path.join(__dirname, '/integration/node_hashbang/main.js'), {
      defaultTargetOptions: {
        shouldScopeHoist: true,
      },
    });

    let main = await outputFS.readFile(
      path.join(fixturePath, 'dist', 'node', 'main.js'),
      'utf8',
    );
    assert.equal(main.lastIndexOf('#!/usr/bin/env node\n'), 0);
    await outputFS.rimraf(path.join(fixturePath, 'dist'));
  });
});

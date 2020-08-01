import assert from 'assert';
import path from 'path';
import {
  bundle,
  run,
  assertBundles,
  distDir,
  removeDistDirectory,
  outputFS,
  overlayFS,
  ncp,
} from '@parcel/test-utils';

async function runBundle() {
  return await bundle(path.join(__dirname, '/input/src/index.js'), {
    inputFS: overlayFS,
    disableCache: false,
  });
}

async function testCache(update) {
  // Delete cache from previous test and perform initial build
  await overlayFS.rimraf(path.join(__dirname, '/input'));
  await ncp(
    path.join(__dirname, '/integration/cache'),
    path.join(__dirname, '/input'),
  );
  await overlayFS.rimraf(path.join(__dirname, '/input/.parcel-cache'));
  await overlayFS.rimraf(path.join(__dirname, '/input/dist'));
  let b = await runBundle();

  // update
  await update(b);

  // Run cached build
  b = await runBundle();

  return b;
}

async function assertThrows(fn) {
  let threw = false;
  let e;
  try {
    await fn();
  } catch (err) {
    threw = true;
    e = err;
  }

  assert(threw, 'did not throw');
  return e;
}

describe.only('cache', function() {
  it('should support updating a JS file', async function() {
    let b = await testCache(async b => {
      assert.equal(await run(b), 4);
      await overlayFS.writeFile(
        path.join(__dirname, '/input/src/nested/test.js'),
        'export default 4',
      );
    });

    assert.equal(await run(b), 6);
  });

  it('should support adding a dependency', async function() {
    let b = await testCache(async b => {
      assert.equal(await run(b), 4);
      await overlayFS.writeFile(
        path.join(__dirname, '/input/src/nested/foo.js'),
        'export default 6',
      );
      await overlayFS.writeFile(
        path.join(__dirname, '/input/src/nested/test.js'),
        'export {default} from "./foo";',
      );
    });

    assert.equal(await run(b), 8);
  });

  it('should error when deleting a file', async function() {
    let e = await assertThrows(async () => {
      await testCache(async b => {
        await overlayFS.unlink(
          path.join(__dirname, '/input/src/nested/test.js'),
        );
      });
    });

    assert.equal(
      e.message,
      "Failed to resolve './nested/test' from './src/index.js'",
    );
  });

  it('should error when starting parcel from a broken state with no changes', async function() {
    await assertThrows(async () => {
      await testCache(async b => {
        await overlayFS.unlink(
          path.join(__dirname, '/input/src/nested/test.js'),
        );
      });
    });

    // Do a third build from a failed state with no changes
    let e = await assertThrows(async () => {
      await runBundle();
    });
    assert.equal(
      e.message,
      "Failed to resolve './nested/test' from './src/index.js'",
    );
  });

  describe('babel', function() {
    it('should support adding a .babelrc', function() {});

    it('should support updating a .babelrc', function() {});

    it('should support updating an extended .babelrc', function() {});

    it('should support adding a nested .babelrc', function() {});

    it('should support updating a nested .babelrc', function() {});

    it('should support deleting a nested .babelrc', function() {});

    it('should support deleting a custom .babelrc', function() {});
  });

  describe('parcel config', function() {
    it('should support adding a .parcelrc', function() {});

    it('should support updating a .parcelrc', function() {});

    it('should support updating an extended .parcelrc', function() {});

    it('should support deleting a .parcelrc', function() {});
  });

  describe('entries', function() {
    it('should support adding an entry that matches a glob', function() {});

    it('should support deleting an entry that matches a glob', function() {});

    it('should error when deleting a file entry', function() {});

    it('should recover from errors when adding a missing entry', function() {});
  });

  describe('target config', function() {
    it('should support adding a target config', function() {});

    it('should support adding a second target', function() {});

    it('should support changing target output location', function() {});

    it('should support updating target config options', function() {});

    it('should support deleting a target', function() {});

    it('should support deleting all targets', function() {});
  });

  describe('resolver', function() {
    it('should support updating a package.json#main field', function() {});

    it('should support adding an alias', function() {});

    it('should support updating an alias', function() {});

    it('should support deleting an alias', function() {});

    it('should support adding a node_modules folder', function() {});

    it('should support adding a package.json', function() {});

    it('should support updating a symlink', function() {});
  });

  describe('bundler config', function() {
    it('should support adding bundler config', function() {});

    it('should support updating bundler config', function() {});

    it('should support removing bundler config', function() {});
  });

  describe('scope hoisting', function() {
    it('should support adding sideEffects config', function() {});

    it('should support updating sideEffects config', function() {});

    it('should support removing sideEffects config', function() {});
  });
});

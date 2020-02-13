// @flow

import {MemoryFS, NodeFS, OverlayFS} from '@parcel/fs';
import assert from 'assert';
import invariant from 'assert';
import path from 'path';
import sinon from 'sinon';
import ThrowableDiagnostic from '@parcel/diagnostic';
import WorkerFarm from '@parcel/workers';
import {MockPackageInstaller, NodePackageManager} from '../';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('NodePackageManager', () => {
  let fs;
  let packageManager;
  let packageInstaller;
  let workerFarm;

  beforeEach(() => {
    workerFarm = new WorkerFarm({
      workerPath: require.resolve('@parcel/core/src/worker.js'),
    });
    fs = new OverlayFS(new MemoryFS(workerFarm), new NodeFS());
    packageInstaller = new MockPackageInstaller();
    packageManager = new NodePackageManager(fs, packageInstaller);
  });

  afterEach(async () => {
    await workerFarm.end();
  });

  it('resolves packages that exist', async () => {
    assert.deepEqual(
      await packageManager.resolve(
        'foo',
        path.join(FIXTURES_DIR, 'has-foo/index.js'),
      ),
      {
        pkg: {
          version: '1.1.0',
        },
        resolved: path.join(FIXTURES_DIR, 'has-foo/node_modules/foo/index.js'),
      },
    );
  });

  it('requires packages that exist', async () => {
    assert.deepEqual(
      await packageManager.require(
        'foo',
        path.join(FIXTURES_DIR, 'has-foo/index.js'),
      ),
      'foobar',
    );
  });

  it("autoinstalls packages that don't exist", async () => {
    packageInstaller.register('a', fs, path.join(FIXTURES_DIR, 'packages/a'));

    assert.deepEqual(
      await packageManager.resolve(
        'a',
        path.join(FIXTURES_DIR, 'has-foo/index.js'),
      ),
      {
        pkg: {
          name: 'a',
        },
        resolved: path.join(FIXTURES_DIR, 'has-foo/node_modules/a/index.js'),
      },
    );
  });

  it('does not autoinstall packages that are already listed in package.json', async () => {
    packageInstaller.register('a', fs, path.join(FIXTURES_DIR, 'packages/a'));

    let err;
    try {
      await packageManager.resolve(
        'a',
        path.join(FIXTURES_DIR, 'has-a-not-yet-installed/index.js'),
      );
    } catch (_err) {
      err = _err;
    }

    invariant(err instanceof ThrowableDiagnostic);
    assert(err.message.includes('Run your package manager'));
  });

  describe('range mismatch', () => {
    it("cannot autoinstall if there's a local requirement", async () => {
      let err;
      try {
        await packageManager.resolve(
          'foo',
          path.join(FIXTURES_DIR, 'has-foo/index.js'),
          {
            range: '^2.0.0',
          },
        );
      } catch (_err) {
        err = _err;
      }

      invariant(err instanceof ThrowableDiagnostic);
      assert.equal(
        err.message,
        'Could not find module "foo" satisfying ^2.0.0.',
      );
    });

    it("can autoinstall into local package if there isn't a local requirement", async () => {
      packageInstaller.register(
        'foo',
        fs,
        path.join(FIXTURES_DIR, 'packages/foo-2.0'),
      );

      let spy = sinon.spy(packageInstaller, 'install');
      assert.deepEqual(
        await packageManager.resolve(
          'foo',
          path.join(FIXTURES_DIR, 'has-foo/subpackage/index.js'),
          {
            range: '^2.0.0',
          },
        ),
        {
          pkg: {
            name: 'foo',
            version: '2.0.0',
          },
          resolved: path.join(
            FIXTURES_DIR,
            'has-foo/subpackage/node_modules/foo/index.js',
          ),
        },
      );

      assert.deepEqual(spy.args, [
        [
          {
            cwd: path.join(FIXTURES_DIR, 'has-foo/subpackage'),
            packagePath: path.join(
              FIXTURES_DIR,
              'has-foo/subpackage/package.json',
            ),
            fs,
            saveDev: true,
            modules: [{name: 'foo', range: '^2.0.0'}],
          },
        ],
      ]);
    });
  });
});

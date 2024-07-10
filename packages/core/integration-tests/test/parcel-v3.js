// @flow

import assert from 'assert';
import {join} from 'path';

import {ParcelV3} from '@parcel/core';
import {NodePackageManager} from '@parcel/package-manager';
import type {FileSystem} from '@parcel/rust';
import {bundle, fsFixture, inputFS, overlayFS, run} from '@parcel/test-utils';
import type {
  Encoding,
  FilePath,
  FileSystem as ClassicFileSystem,
} from '@parcel/types-internal';

describe('parcel-v3', function () {
  // Add to @parcel/utils later
  function toFileSystemV3(fs: ClassicFileSystem): FileSystem {
    return {
      canonicalize: (path: FilePath) => fs.realpathSync(path),
      cwd: () => fs.cwd(),
      readFile: (path: string, encoding?: Encoding) =>
        fs.readFileSync(path, encoding ?? 'utf8'),
      isFile: (path: string) => {
        try {
          return fs.statSync(path).isFile();
        } catch {
          return false;
        }
      },
      isDir: (path: string) => {
        try {
          return fs.statSync(path).isDirectory();
        } catch {
          return false;
        }
      },
    };
  }

  // Duplicated temporarily for convenience, will remove once the Rust stuff works
  it.skip('should produce a basic JS bundle with CommonJS requires', async function () {
    let b = await bundle(join(__dirname, '/integration/commonjs/index.js'), {
      featureFlags: {parcelV3: true},
    });

    // assert.equal(b.assets.size, 8);
    // assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should run the main-thread bootstrap function', async function () {
    await fsFixture(overlayFS, __dirname)`
      index.js:
        console.log('hello world');

      .parcelrc:
        {
          "extends": "@parcel/config-default"
        }

      yarn.lock: {}
    `;

    let parcel = new ParcelV3({
      corePath: '',
      entries: [join(__dirname, 'index.js')],
      fs: toFileSystemV3(overlayFS),
      nodeWorkers: 1,
      packageManager: new NodePackageManager(inputFS, __dirname),
      projectRoot: __dirname,
    });

    assert(
      typeof (await parcel._internal.testingTempFsReadToString(__filename)) ===
        'string',
    );
    assert(!(await parcel._internal.testingTempFsIsDir(__filename)));
    assert(await parcel._internal.testingTempFsIsFile(__filename));

    await parcel.build();
  });
});

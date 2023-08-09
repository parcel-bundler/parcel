// @flow
import assert from 'assert';
import path from 'path';
import {
  bundle,
  run,
  assertBundles,
  outputFS,
  inputFS,
} from '@parcel/test-utils';
import {MemoryFS, OverlayFS} from '@parcel/fs';
import nullthrows from 'nullthrows';
import {workerFarm} from '../../test-utils/src/utils';

describe('glob', function () {
  it('should require a glob of files', async function () {
    let b = await bundle(path.join(__dirname, '/integration/glob/index.js'));

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', '*.js', 'a.js', 'b.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should require nested directories with a glob', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/glob-deep/index.js'),
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', '*.js', 'a.js', 'b.js', 'c.js', 'z.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 13);
  });

  it('should support importing a glob of CSS files', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/glob-css/index.js'),
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        name: 'index.css',
        assets: ['*.css', 'index.css', 'other.css', 'local.css'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(
      nullthrows(b.getBundles().find(b => b.type === 'css')).filePath,
      'utf8',
    );
    assert(css.includes('.local'));
    assert(css.includes('.other'));
    assert(css.includes('.index'));
  });

  it('should require a glob using a pipeline', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/glob-pipeline/index.js'),
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', '*.js', 'bundle-url.js'],
      },
      {
        type: 'txt',
        assets: ['a.txt'],
      },
      {
        type: 'txt',
        assets: ['b.txt'],
      },
    ]);

    let output = await run(b);
    assert.deepEqual(output, {
      a: `http://localhost/${path.basename(
        nullthrows(b.getBundles().find(b => b.name.startsWith('a'))).filePath,
      )}`,
      b: `http://localhost/${path.basename(
        nullthrows(b.getBundles().find(b => b.name.startsWith('b'))).filePath,
      )}`,
    });
  });

  it('should import a glob with dynamic import', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/glob-async/index.js'),
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          '*.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        type: 'js',
        assets: ['a.js'],
      },
      {
        type: 'js',
        assets: ['b.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(await output(), 3);
  });

  it('should error when an unsupported asset type imports a glob', async function () {
    let filePath = path.join(__dirname, '/integration/glob-error/index.html');
    // $FlowFixMe[prop-missing]
    await assert.rejects(() => bundle(filePath), {
      name: 'BuildError',
      diagnostics: [
        {
          message: "Failed to resolve 'foo/\\*.js' from './index.html'",
          origin: '@parcel/core',
        },
        {
          message: 'Glob imports are not supported in html files.',
          origin: '@parcel/resolver-glob',
          codeFrames: undefined,
        },
      ],
    });
  });

  it('should error when a URL dependency imports a glob', async function () {
    let filePath = path.join(__dirname, '/integration/glob-error/index.css');
    // $FlowFixMe[prop-missing]
    await assert.rejects(() => bundle(filePath), {
      name: 'BuildError',
      diagnostics: [
        {
          message: "Failed to resolve 'images/\\*.jpg' from './index.css'",
          origin: '@parcel/core',
          codeFrames: [
            {
              filePath,
              code: await inputFS.readFile(filePath, 'utf8'),
              codeHighlights: [
                {
                  message: undefined,
                  start: {
                    column: 19,
                    line: 2,
                  },
                  end: {
                    column: 30,
                    line: 2,
                  },
                },
              ],
            },
          ],
        },
        {
          message: 'Glob imports are not supported in URL dependencies.',
          origin: '@parcel/resolver-glob',
          codeFrames: [
            {
              codeHighlights: [
                {
                  message: undefined,
                  start: {
                    column: 19,
                    line: 2,
                  },
                  end: {
                    column: 30,
                    line: 2,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('should require a glob of files from a package', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/glob-package/index.js'),
    );
    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['*.js', '*.js', 'a.js', 'b.js', 'x.js', 'y.js', 'index.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 10);
  });

  it('should require a glob of files from a package async', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/glob-package-async/index.js'),
    );
    await assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          '*.js',
          '*.js',
          'bundle-url.js',
          'cacheLoader.js',
          'index.js',
          'js-loader.js',
        ],
      },
      {type: 'js', assets: ['a.js']},
      {type: 'js', assets: ['b.js']},
      {type: 'js', assets: ['x.js']},
      {type: 'js', assets: ['y.js']},
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 10);
  });

  it('should correctly resolve a glob with ~', async function () {
    const beforeHome = process.env.HOME;
    try {
      // This drives `os.homedir` behind the curtains
      process.env.HOME = '/heart';

      // Create input files in-memory for the fake home directory
      const inMemoryInputFS = new MemoryFS(workerFarm);
      inMemoryInputFS.mkdirp('/heart');
      inMemoryInputFS.writeFile('/heart/a.js', 'module.exports = 1;');
      inMemoryInputFS.writeFile('/heart/b.js', 'module.exports = 2;');

      let b = await bundle(
        path.join(__dirname, '/integration/glob-homedir/index.js'),
        {
          // Use an overlay so `/heart` is present along with real files on the
          // host system. Not entirely sure this is the intended use of
          // OverlayFS but it seems to work properly for this test.
          inputFS: new OverlayFS(inMemoryInputFS, inputFS),
        },
      );

      await assertBundles(b, [
        {
          name: 'index.js',
          assets: ['index.js', '*.js', 'a.js', 'b.js'],
        },
      ]);
    } finally {
      process.env.HOME = beforeHome;
    }
  });

  it('should correctly resolve an absolute glob', async function () {
    // Create input files in-memory for the fake home directory
    const inMemoryInputFS = new MemoryFS(workerFarm);
    inMemoryInputFS.mkdirp('/some-absolute-dir');
    inMemoryInputFS.writeFile('/some-absolute-dir/a.js', 'module.exports = 1;');
    inMemoryInputFS.writeFile('/some-absolute-dir/b.js', 'module.exports = 2;');

    let b = await bundle(
      path.join(__dirname, '/integration/glob-absolute/index.js'),
      {
        inputFS: new OverlayFS(inMemoryInputFS, inputFS),
      },
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', '*.js', 'a.js', 'b.js'],
      },
    ]);
  });
});

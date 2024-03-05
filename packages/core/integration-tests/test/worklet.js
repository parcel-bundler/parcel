import assert from 'assert';
import path from 'path';
import {
  bundle,
  run,
  runBundle,
  assertBundles,
  removeDistDirectory,
} from '@parcel/test-utils';

describe.only('worklet', function () {
  beforeEach(async () => {
    await removeDistDirectory();
  });

  it('should support url: imports of another javascript file', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/worklet/pipeline.js'),
      {
        mode: 'production',
      },
    );

    assertBundles(b, [
      {
        name: 'pipeline.js',
        assets: ['bundle-url.js', 'pipeline.js', 'bundle-manifest.js'],
      },
      {
        type: 'js',
        assets: ['worklet.js', 'colors.js'],
      },
    ]);

    let url;
    await run(b, {
      CSS: {
        paintWorklet: {
          addModule(u) {
            url = u;
          },
        },
      },
    });
    assert(/^http:\/\/localhost\/worklet\.[0-9a-f]+\.js$/.test(url));

    let name;
    await runBundle(
      b,
      b.getBundles()[1],
      {
        registerPaint(n) {
          name = n;
        },
      },
      {require: false},
    );

    assert.equal(name, 'checkerboard');
  });

  it('should support new URL() of another javascript file', async function () {
    let b = await bundle(path.join(__dirname, '/integration/worklet/url.js'));

    assertBundles(b, [
      {
        name: 'url.js',
        assets: ['bundle-url.js', 'esmodule-helpers.js', 'url.js'],
      },
      {
        type: 'js',
        assets: ['worklet.js', 'colors.js', 'esmodule-helpers.js'],
      },
    ]);

    let res = await run(b);
    assert(/^http:\/\/localhost\/worklet\.[0-9a-f]+\.js$/.test(res.default));

    let name;
    await runBundle(
      b,
      b.getBundles()[1],
      {
        registerPaint(n) {
          name = n;
        },
      },
      {require: false},
    );

    assert.equal(name, 'checkerboard');
  });

  it('should support CSS paint worklets', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/worklet/url-worklet.js'),
    );

    assertBundles(b, [
      {
        name: 'url-worklet.js',
        assets: ['bundle-url.js', 'url-worklet.js'],
      },
      {
        type: 'js',
        assets: ['worklet.js', 'colors.js', 'esmodule-helpers.js'],
      },
    ]);

    let url;
    await run(b, {
      CSS: {
        paintWorklet: {
          addModule(u) {
            url = u;
          },
        },
      },
    });
    assert(/^http:\/\/localhost\/worklet\.[0-9a-f]+\.js$/.test(url));

    let name;
    await runBundle(
      b,
      b.getBundles()[1],
      {
        registerPaint(n) {
          name = n;
        },
      },
      {require: false},
    );

    assert.equal(name, 'checkerboard');
  });

  it('should error on dynamic import() inside worklets', async function () {
    let errored = false;
    try {
      await bundle(
        path.join(__dirname, '/integration/worklet/url-worklet-error.js'),
      );
    } catch (err) {
      errored = true;
      assert.equal(err.message, 'import() is not allowed in worklets.');
      assert.deepEqual(err.diagnostics, [
        {
          message: 'import() is not allowed in worklets.',
          origin: '@parcel/transformer-js',
          codeFrames: [
            {
              filePath: path.join(
                __dirname,
                '/integration/worklet/worklet-error.js',
              ),
              codeHighlights: [
                {
                  message: undefined,
                  start: {
                    line: 1,
                    column: 8,
                  },
                  end: {
                    line: 1,
                    column: 18,
                  },
                },
              ],
            },
            {
              filePath: path.join(
                __dirname,
                'integration/worklet/url-worklet-error.js',
              ),
              codeHighlights: [
                {
                  message: 'The environment was originally created here',
                  start: {
                    line: 1,
                    column: 36,
                  },
                  end: {
                    line: 1,
                    column: 53,
                  },
                },
              ],
            },
          ],
          hints: ['Try using a static `import`.'],
        },
      ]);
    }

    assert(errored);
  });

  it('should support audio worklets via a pipeline', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/worklet/worklet-pipeline.js'),
      {
        mode: 'production',
      },
    );

    assertBundles(b, [
      {
        name: 'worklet-pipeline.js',
        assets: ['bundle-url.js', 'bundle-manifest.js', 'worklet-pipeline.js'],
      },
      {
        type: 'js',
        assets: ['worklet.js', 'colors.js'],
      },
    ]);

    let res = await run(b);
    assert(/^http:\/\/localhost\/worklet\.[0-9a-f]+\.js$/.test(res));

    let name;
    await runBundle(
      b,
      b.getBundles()[1],
      {
        registerPaint(n) {
          name = n;
        },
      },
      {require: false},
    );

    assert.equal(name, 'checkerboard');
  });

  it('should error on dynamic import() inside worklets imported via a pipeline', async function () {
    let errored = false;
    try {
      await bundle(
        path.join(__dirname, '/integration/worklet/worklet-pipeline-error.js'),
      );
    } catch (err) {
      errored = true;
      assert.equal(err.message, 'import() is not allowed in worklets.');
      assert.deepEqual(err.diagnostics, [
        {
          message: 'import() is not allowed in worklets.',
          origin: '@parcel/transformer-js',
          codeFrames: [
            {
              filePath: path.join(
                __dirname,
                '/integration/worklet/worklet-error.js',
              ),
              codeHighlights: [
                {
                  message: undefined,
                  start: {
                    line: 1,
                    column: 8,
                  },
                  end: {
                    line: 1,
                    column: 18,
                  },
                },
              ],
            },
          ],
          hints: ['Try using a static `import`.'],
        },
      ]);
    }

    assert(errored);
  });
});

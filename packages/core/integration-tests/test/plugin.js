// @flow

import assert from 'assert';
import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {
  assertBundles,
  bundle,
  bundler,
  distDir,
  findAsset,
  getNextBuild,
  outputFS as fs,
  overlayFS,
  run,
} from '@parcel/test-utils';
import * as wasmmap from 'wasm-sourcemap';
import {relativePath} from '@parcel/utils';

describe('plugin', function () {
  it("continue transformer pipeline on type change that doesn't change the pipeline", async function () {
    await bundle(
      path.join(__dirname, '/integration/pipeline-type-change/index.ini'),
    );

    let output = await fs.readFile(path.join(distDir, 'index.txt'), 'utf8');
    assert.equal(
      output,
      `INPUT
parcel-transformer-a
parcel-transformer-b`,
    );
  });

  it('should allow optimizer plugins to change the output file type', async function () {
    await bundle(
      path.join(__dirname, '/integration/optimizer-changing-type/index.js'),
    );

    assert.deepEqual(fs.readdirSync(distDir), ['index.test']);
  });

  it('should allow resolver plugins to disable deferring', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/resolver-canDefer/index.js'),
      {mode: 'production'},
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index.js', 'index.js', 'a.js', 'b.js'],
      },
    ]);
  });

  it('should allow resolvers to return changes for dependency.meta', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/resolver-dependency-meta/a.js'),
      {shouldDisableCache: false, shouldContentHash: false, inputFS: overlayFS},
    );

    let calls = [];
    await run(b, {
      sideEffect(v) {
        calls.push(v);
      },
    });
    assert.deepEqual(calls, [1234]);

    await overlayFS.writeFile(
      path.join(__dirname, '/integration/resolver-dependency-meta/a.js'),
      (await overlayFS.readFile(
        path.join(__dirname, '/integration/resolver-dependency-meta/a.js'),
        'utf8',
      )) + '\n// abc',
    );

    b = await bundle(
      path.join(__dirname, '/integration/resolver-dependency-meta/a.js'),
      {shouldDisableCache: false, shouldContentHash: false, inputFS: overlayFS},
    );

    calls = [];
    await run(b, {
      sideEffect(v) {
        calls.push(v);
      },
    });
    assert.deepEqual(calls, [1234]);
  });

  it('invalidate the cache based on loadBundleConfig in a packager', async function () {
    let fixture = path.join(
      __dirname,
      '/integration/packager-loadBundleConfig',
    );
    let entry = path.join(fixture, 'index.html');

    let b = await bundler(entry, {
      inputFS: overlayFS,
      shouldDisableCache: false,
    });

    let subscription = await b.watch();
    try {
      let bundleEvent = await getNextBuild(b);
      invariant(bundleEvent.type === 'buildSuccess');

      assert.strictEqual(
        await overlayFS.readFile(
          nullthrows(
            bundleEvent.bundleGraph
              .getBundles()
              .find(b => b.getMainEntry()?.filePath.endsWith('a.txt')),
          ).filePath,
          'utf8',
        ),
        `Bundles: a.txt. Contents: Hello from a\n`,
      );

      await overlayFS.copyFile(path.join(fixture, 'index.2.html'), entry);

      bundleEvent = await getNextBuild(b);
      invariant(bundleEvent.type === 'buildSuccess');

      assert.strictEqual(
        await overlayFS.readFile(
          nullthrows(
            bundleEvent.bundleGraph
              .getBundles()
              .find(b => b.getMainEntry()?.filePath.endsWith('a.txt')),
          ).filePath,
          'utf8',
        ),
        `Bundles: a.txt,b.txt. Contents: Hello from a\n`,
      );
      assert.strictEqual(
        await overlayFS.readFile(
          nullthrows(
            bundleEvent.bundleGraph
              .getBundles()
              .find(b => b.getMainEntry()?.filePath.endsWith('b.txt')),
          ).filePath,
          'utf8',
        ),
        `Bundles: a.txt,b.txt. Contents: Hello from b\n`,
      );
    } finally {
      await subscription.unsubscribe();
    }
  });

  it('invalidate the cache based on loadConfig in a packager', async function () {
    let fixture = path.join(__dirname, '/integration/packager-loadConfig');
    let entry = path.join(fixture, 'index.txt');
    let config = path.join(fixture, 'foo.config.json');
    let b = await bundle(entry, {
      inputFS: overlayFS,
      shouldDisableCache: false,
    });

    assert.strictEqual(
      await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8'),
      '1234',
    );

    await overlayFS.writeFile(config, JSON.stringify({contents: 'xyz'}));

    b = await bundle(entry, {
      inputFS: overlayFS,
      shouldDisableCache: false,
    });
    assert.strictEqual(
      await overlayFS.readFile(b.getBundles()[0].filePath, 'utf8'),
      'xyz',
    );
  });

  it('merges symbol information when applying runtime assets', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/runtime-symbol-merging/entry.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
        mode: 'production',
      },
    );

    assert(!findAsset(b, 'index.js'));
    assert.deepStrictEqual(
      new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'a.js')))),
      new Set(['a']),
    );
    assert.deepStrictEqual(
      new Set(b.getUsedSymbols(nullthrows(findAsset(b, 'b.js')))),
      new Set(['b']),
    );

    let calls = [];
    await run(b, {
      call(v) {
        calls.push(v);
      },
    });
    assert.deepStrictEqual(calls, [789, 123]);
  });

  it('properly excludes assets that are excluded and deferred by both app code and runtimes', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/runtime-deferred-excluded/index.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    let calls = [];
    let output = await run(b, {
      f(v) {
        calls.push(v);
      },
    });

    assert.deepStrictEqual(
      // `output` is from the vm and so is not deepStrictEqual
      [...output],
      ['index', 'used'],
    );
    assert.deepStrictEqual(calls, ['used']);
  });

  it('handles multiple assets returned by a transformer', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/multi-asset-transformer/index.js'),
      {
        defaultTargetOptions: {
          shouldScopeHoist: true,
        },
      },
    );

    assert.equal(await run(b), 2);
  });

  it('throws when multiple assets returned by a transformer import a missing symbol', async function () {
    let source = path.join(
      __dirname,
      '/integration/multi-asset-transformer-export/index.js',
    );
    let message = `index.js does not export 'foo'`;

    // $FlowFixMe[prop-missing]
    await assert.rejects(
      () =>
        bundle(source, {
          defaultTargetOptions: {
            shouldScopeHoist: true,
          },
        }),
      {
        name: 'BuildError',
        message,
        diagnostics: [
          {
            message,
            origin: '@parcel/core',
            codeFrames: [
              {
                filePath: source,
                language: 'js',
                codeHighlights: [
                  {
                    message: undefined,
                    start: {
                      line: 1,
                      column: 9,
                    },
                    end: {
                      line: 1,
                      column: 11,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
  });

  it('should allow resolvers to invalidateOnEnvChange', async () => {
    async function assertAsset(replacedCode) {
      let b = await bundle(
        path.join(
          __dirname,
          '/integration/resolver-can-invalidateonenvchange/index.js',
        ),
        {
          shouldDisableCache: false,
          inputFS: overlayFS,
          env: {replacedCode},
        },
      );
      let code = await b.getBundles()[0].getEntryAssets()[0].getCode();
      assert(code.indexOf(replacedCode) !== -1);
    }
    await assertAsset('const replaced = 1;');
    await assertAsset('const replaced = 2;');
  });

  it('should output sourcemaps when packaging Wasm', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/wasm-sourcemap-transformer/index.js'),
    );
    let wasmPath = nullthrows(
      b.getBundles().find(b => b.type === 'wasm'),
    ).filePath;
    let mapPath = wasmPath + '.map';
    assert(await fs.exists(mapPath));

    let wasm = await fs.readFile(wasmPath);
    assert.equal(
      wasmmap.GetSourceMapURL(wasm),
      relativePath(distDir, mapPath, false),
    );
  });
});

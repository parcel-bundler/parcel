import assert from 'assert';
import path from 'path';
import url from 'url';
import {
  assertBundles,
  bundle,
  distDir,
  inputFS,
  ncp,
  outputFS,
  overlayFS,
  removeDistDirectory,
  run,
} from '@parcel/test-utils';

describe.only('url', function () {
  beforeEach(async () => {
    await removeDistDirectory();
  });

  it('should support url: imports with CommonJS output', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/commonjs-import-url/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'esmodule-helpers.js'],
      },
      {
        type: 'txt',
        assets: ['x.txt'],
      },
    ]);

    let txtBundle = b.getBundles().find(b => b.type === 'txt').filePath;

    let output = await run(b);
    assert.strictEqual(path.basename(output), path.basename(txtBundle));
  });

  it('should support importing a URL to a raw asset', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/import-raw/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js'],
      },
      {
        type: 'txt',
        assets: ['test.txt'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(/^http:\/\/localhost\/test\.[0-9a-f]+\.txt$/.test(output()));
    let stats = await outputFS.stat(
      path.join(distDir, url.parse(output()).pathname),
    );
    assert.equal(stats.size, 9);
  });

  it('should support referencing a raw asset with static URL and import.meta.url', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/import-raw-import-meta-url/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js', 'esmodule-helpers.js'],
      },
      {
        type: 'txt',
        assets: ['test.txt'],
      },
    ]);

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('import.meta.url'));

    let output = await run(b);
    assert(/^http:\/\/localhost\/test\.[0-9a-f]+\.txt$/.test(output.default));
    let stats = await outputFS.stat(
      path.join(distDir, output.default.pathname),
    );
    assert.equal(stats.size, 9);
  });

  it('should support referencing a raw asset with static URL and CJS __filename', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/import-raw-import-meta-url/cjs.js'),
    );

    assertBundles(b, [
      {
        name: 'cjs.js',
        assets: ['cjs.js', 'bundle-url.js', 'esmodule-helpers.js'],
      },
      {
        type: 'txt',
        assets: ['test.txt'],
      },
    ]);

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(!contents.includes('import.meta.url'));

    let output = await run(b);
    assert(/^http:\/\/localhost\/test\.[0-9a-f]+\.txt$/.test(output.default));
    let stats = await outputFS.stat(
      path.join(distDir, output.default.pathname),
    );
    assert.equal(stats.size, 9);
  });

  it('should ignore new URL and import.meta.url with local binding', async function () {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/import-raw-import-meta-url/local-url.js',
      ),
    );

    assertBundles(b, [
      {
        name: 'local-url.js',
        assets: ['esmodule-helpers.js', 'local-url.js'],
      },
    ]);

    let contents = await outputFS.readFile(b.getBundles()[0].filePath, 'utf8');
    assert(contents.includes('"file:///local-url.js"'));
  });

  it('should throw a codeframe for a missing raw asset with static URL and import.meta.url', async function () {
    let fixture = path.join(
      __dirname,
      'integration/import-raw-import-meta-url/missing.js',
    );
    let code = await inputFS.readFileSync(fixture, 'utf8');
    await assert.rejects(() => bundle(fixture), {
      name: 'BuildError',
      diagnostics: [
        {
          codeFrames: [
            {
              filePath: fixture,
              code,
              codeHighlights: [
                {
                  message: undefined,
                  end: {
                    column: 36,
                    line: 1,
                  },
                  start: {
                    column: 24,
                    line: 1,
                  },
                },
              ],
            },
          ],
          message: "Failed to resolve 'invalid.txt' from './missing.js'",
          origin: '@parcel/core',
        },
        {
          hints: [],
          message: "Cannot load file './invalid.txt' in './'.",
          origin: '@parcel/resolver-default',
        },
      ],
    });
  });

  it('should support importing a URL to a large raw asset', async function () {
    // 6 megabytes, which exceeds the threshold in summarizeRequest for buffering
    // entire contents into memory and should stream content instead
    let assetSizeBytes = 6000000;

    let distDir = path.join(outputFS.cwd(), '/dist');
    let fixtureDir = path.join(__dirname, '/integration/import-raw');
    let inputDir = path.join(__dirname, 'input');

    await ncp(fixtureDir, inputDir);
    await outputFS.writeFile(
      path.join(inputDir, 'test.txt'),
      Buffer.alloc(assetSizeBytes),
    );

    let b = await bundle(path.join(inputDir, 'index.js'), {
      inputFS: overlayFS,
      defaultTargetOptions: {
        distDir,
      },
    });
    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'bundle-url.js'],
      },
      {
        type: 'txt',
        assets: ['test.txt'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(/^http:\/\/localhost\/test\.[0-9a-f]+\.txt$/.test(output()));
    let stats = await outputFS.stat(
      path.join(distDir, url.parse(output()).pathname),
    );
    assert.equal(stats.size, assetSizeBytes);
  });
});

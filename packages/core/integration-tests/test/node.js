import assert from 'assert';
import path from 'path';
import {
  bundle,
  run,
  runBundle,
  assertBundles,
  removeDistDirectory,
} from '@parcel/test-utils';

describe.only('node', function () {
  beforeEach(async () => {
    await removeDistDirectory();
  });

  it('should not bundle node_modules for a node environment', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js', 'local.js'],
      },
    ]);

    await outputFS.mkdirp(path.join(distDir, 'node_modules/testmodule'));
    await outputFS.writeFile(
      path.join(distDir, 'node_modules/testmodule/index.js'),
      'exports.a = 5;',
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 7);
  });

  it('should bundle node_modules for a node environment if includeNodeModules is specified', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/include_node_modules/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js', 'local.js', 'index.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should not bundle builtins for a node environment if includeNodeModules is specified', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/include_builtins-node/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['esmodule-helpers.js', 'main.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    let [fs, filepath] = output();
    assert.equal(filepath, path.join('app', 'index.js'));
    assert.equal(typeof fs.readFile, 'function');
  });

  it('should split bundles when a dynamic import is used with a node environment', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-node/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        assets: ['local.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should not insert environment variables in node environment', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/env-node/index.js'),
    );

    let output = await run(b);
    assert.ok(output.toString().includes('process.env'));
    assert.equal(output(), 'test:test');
  });

  it('should not touch process.browser for target node', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/process/index.js'),
      {
        targets: {
          main: {
            context: 'node',
            distDir: path.join(__dirname, '/integration/process/dist.js'),
          },
        },
      },
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.browser') !== -1);
    assert.equal(output(), false);
  });

  it('should not exclude resolving specifiers that map to false in the browser field in node builds', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/resolve-entries/pkg-ignore-browser/index.js',
      ),
      {
        targets: ['node'],
      },
    );

    assert.equal(await run(b), 'this should only exist in non-browser builds');
  });

  it.skip('should not resolve the browser field for --target=node', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser.js'),
      {
        target: 'node',
      },
    );

    assertBundles(b, {
      name: 'browser.js',
      assets: ['browser.js', 'node-module.js'],
      childBundles: [
        {
          type: 'map',
        },
      ],
    });

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-main');
  });

  it.skip('should not resolve advanced browser resolution with --target=node', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser-multiple.js'),
      {
        target: 'node',
      },
    );

    assertBundles(b, {
      name: 'browser-multiple.js',
      assets: ['browser-multiple.js', 'node-entry.js', 'projected.js'],
      childBundles: [
        {
          type: 'map',
        },
      ],
    });

    let {test: output} = await run(b);

    assert.equal(typeof output.projected.test, 'function');
    assert.equal(typeof output.entry.test, 'function');
    assert.equal(output.projected.test(), 'pkg-main-multiple');
    assert.equal(output.entry.test(), 'pkg-browser-multiple main-entry');
  });

  it.skip('should support importing HTML from JS async with --target=node', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/import-html-async/index.js'),
      {
        target: 'node',
        defaultTargetOptions: {
          sourceMaps: false,
        },
      },
    );

    assertBundles(b, {
      name: 'index.js',
      assets: ['index.js', 'cacheLoader.js', 'html-loader.js'],
      childBundles: [
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: [
            {
              type: 'png',
              assets: ['100x100.png'],
              childBundles: [],
            },
            {
              type: 'css',
              assets: ['index.css'],
            },
          ],
        },
      ],
    });

    let output = await run(b);
    assert.equal(typeof output, 'string');
    assert(output.includes('<html>'));
    assert(output.includes('Other page'));
  });

  it.skip('should stub require.cache', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require_cache/main.js'),
      {
        target: 'node',
      },
    );

    await run(b);
  });
});

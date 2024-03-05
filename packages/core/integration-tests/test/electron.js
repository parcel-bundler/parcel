import assert from 'assert';
import path from 'path';
import {
  bundle,
  run,
  assertBundles,
  removeDistDirectory,
  distDir,
  outputFS,
} from '@parcel/test-utils';

describe.only('electron', function () {
  beforeEach(async () => {
    await removeDistDirectory();
  });

  it.skip('should not bundle node_modules on --target=electron', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
      {
        target: 'electron',
      },
    );

    assertBundles(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js'],
    });

    await outputFS.mkdirp(path.join(distDir, 'node_modules/testmodule'));
    await outputFS.writeFile(
      path.join(distDir, 'node_modules/testmodule/index.js'),
      'exports.a = 5;',
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 7);
  });

  it.skip('should bundle node_modules on --target=electron and --bundle-node-modules', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
      {
        target: 'electron',
        bundleNodeModules: true,
      },
    );

    assertBundles(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js', 'index.js'],
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should split bundles when a dynamic import is used with an electron-main environment', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-electron-main/index.js'),
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

  it('should split bundles when a dynamic import is used with an electron-renderer environment', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-electron-renderer/index.js'),
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

  it('should not insert environment variables in electron-main environment', async function () {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      targets: {
        main: {
          context: 'electron-main',
          distDir: path.join(__dirname, '/integration/env/dist.js'),
        },
      },
    });

    let output = await run(b);
    assert.ok(output.toString().includes('process.env'));
    assert.equal(output(), 'test:test');
  });

  it('should not insert environment variables in electron-renderer environment', async function () {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      targets: {
        main: {
          context: 'electron-renderer',
          distDir: path.join(__dirname, '/integration/env/dist.js'),
        },
      },
    });

    let output = await run(b);
    assert.ok(output.toString().includes('process.env'));
    assert.equal(output(), 'test:test');
  });

  it('should not touch process.browser for target electron-main', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/process/index.js'),
      {
        targets: {
          main: {
            context: 'electron-main',
            distDir: path.join(__dirname, '/integration/process/dist.js'),
          },
        },
      },
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.browser') !== -1);
    assert.equal(output(), false);
  });

  it('should replace process.browser for target electron-renderer', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/process/index.js'),
      {
        targets: {
          main: {
            context: 'electron-renderer',
            distDir: path.join(__dirname, '/integration/process/dist.js'),
          },
        },
      },
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.browser') === -1);
    assert.equal(output(), true);
    // Running the bundled code has the side effect of setting process.browser = true, which can mess
    // up the instantiation of typescript.sys within validator-typescript, so we want to reset it.
    process.browser = undefined;
  });
});

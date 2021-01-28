import assert from 'assert';
import path from 'path';
import {
  bundle,
  distDir,
  assertBundles,
  run,
  outputFS,
} from '@parcel/test-utils';

describe('elm', function() {
  it('should produce a basic Elm bundle', async function() {
    let b = await bundle(path.join(__dirname, '/integration/elm/index.js'));

    assertBundles(b, [
      {
        type: 'js',
        assets: ['Main.elm', 'index.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output().Elm.Main.init, 'function');
  });
  it('should produce a elm bundle with debugger', async function() {
    let b = await bundle(path.join(__dirname, '/integration/elm/index.js'));

    await run(b);
    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(js.includes('elm$browser$Debugger'));
  });

  it('should apply elm-hot if HMR is enabled', async function() {
    let b = await bundle(path.join(__dirname, '/integration/elm/index.js'), {
      hmrOptions: true,
    });

    assertBundles(b, [
      {
        type: 'js',
        assets: ['HMRRuntime.js', 'Main.elm', 'index.js'],
      },
    ]);

    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(js.includes('[elm-hot]'));
  });

  it('should remove debugger in production', async function() {
    let b = await bundle(path.join(__dirname, '/integration/elm/index.js'), {
      mode: 'production',
    });

    await run(b);
    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!js.includes('elm$browser$Debugger'));
  });

  it('should remove debugger when environment variable `PARCEL_ELM_NO_DEBUG` is set to true', async function() {
    let b = await bundle(path.join(__dirname, '/integration/elm/index.js'), {
      env: {PARCEL_ELM_NO_DEBUG: true},
    });

    await run(b);
    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!js.includes('elm$browser$Debugger'));
  });

  it('should minify Elm in production mode', async function() {
    let b = await bundle(path.join(__dirname, '/integration/elm/index.js'), {
      mode: 'production',
      minify: true,
    });

    await run(b);

    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!js.includes('elm$core'));
    assert(js.includes('Elm'));
    assert(js.includes('init'));
  });
});

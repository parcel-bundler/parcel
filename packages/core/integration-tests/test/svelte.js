import {bundle, assertBundles, run} from '@parcel/test-utils';
import Logger from '@parcel/logger';
import path from 'path';
import assert from 'assert';

describe('svelte', function () {
  it('should support bundling Svelte', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/svelte/App.svelte'),
    );

    assertBundles(b, [
      {
        type: 'css',
        assets: ['App.svelte'],
      },
      {
        type: 'js',
        assets: ['App.svelte', 'esmodule-helpers.js', 'index.mjs'],
      },
    ]);

    await run(b);
  });

  it('should support preprocessing out of the box', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/svelte-ts/App.svelte'),
    );

    assertBundles(b, [
      {
        type: 'css',
        assets: ['App.svelte'],
      },
      {
        type: 'js',
        assets: ['App.svelte', 'esmodule-helpers.js', 'index.mjs'],
      },
    ]);

    await run(b);
  });

  it('should permit disabling preprocessor', async () => {
    const messages = [];
    let loggerDisposable = Logger.onLog(message => {
      messages.push(...message.diagnostics.map(diag => diag.message));
    });
    let b = await bundle(
      path.join(__dirname, '/integration/svelte-nopreprocess/App.svelte'),
      {logLevel: 'verbose'},
    );
    loggerDisposable.dispose();

    assert(
      !messages.includes('Preprocessing svelte file.'),
      'preprocessing was run',
    );

    assertBundles(b, [
      {
        type: 'css',
        assets: ['App.svelte'],
      },
      {
        type: 'js',
        assets: ['App.svelte', 'esmodule-helpers.js', 'index.mjs'],
      },
    ]);

    await run(b);
  });
});

import {bundle, assertBundles, run} from '@parcel/test-utils';
import path from 'path';

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
});

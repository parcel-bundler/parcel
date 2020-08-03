import {join} from 'path';

import logger from '@parcel/logger';
import {bundle, assertBundles} from '@parcel/test-utils';

const timeout = 5 * 60 * 1000; // 5 minutes without the cache

describe('wasm-pack', function() {
  if (typeof WebAssembly === 'undefined') {
    logger.log('WebAssembly is *not* defined');
    return;
  }

  it('should work', async function() {
    this.timeout(timeout);

    const b = await bundle(
      join(__dirname, '/integration/wasm-pack-single/index.js'),
      {
        target: 'browser',
      },
    );

    await assertBundles(b, [
      {
        // name: '',
        // type: '',
        assets: [
          'browser-loader.js',
          'bundle-manifest.js',
          'bundle-url.js',
          'Cargo.toml',
          'index.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'relative-path.js',
          'single_bg.js',
        ],
        // includedFiles: [],
      },
      {
        // name: '',
        // type: '',
        assets: ['single_bg.wasm'],
        // includedFiles: [],
      },
    ]);
  });
});

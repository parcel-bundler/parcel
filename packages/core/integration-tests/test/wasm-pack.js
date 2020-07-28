import path from 'path';
import logger from '@parcel/logger';
import {bundle, assertBundles} from '@parcel/test-utils';

describe('wasm-pack', function() {
  if (typeof WebAssembly === 'undefined') {
    logger.log('WebAssembly is *not* defined');
    return;
  }

  it('should work', async function() {
    const b = await bundle(
      path.join(__dirname, '/integration/wasm-pack-single/index.js'),
      {
        target: 'browser',
      },
    );

    await assertBundles(b, [{assets: ['index.js']}, {assets: ['Cargo.toml']}]);
  });
});

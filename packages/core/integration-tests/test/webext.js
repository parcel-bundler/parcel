import assert from 'assert';
import path from 'path';
import {bundle, run, outputFS, distDir} from '@parcel/test-utils';

describe('webext', function() {
  it('should resolve a full webext bundle', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/webext/manifest.json'),
    );
    console.log(b);
  });
});

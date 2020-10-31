import assert from 'assert';
import path from 'path';
import {bundle, assertBundles} from '@parcel/test-utils';

describe('webext', function() {
  it('should resolve a full webext bundle', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/webext/manifest.json'),
    );
    assertBundles(b, [
      {
        name: 'tmp.aff',
        assets: ['tmp.aff']
      },
      {
        name: 'tmp.dic',
        assets: ['tmp.dic']
      },
      {
        name: 'messages.json',
        assets: ['messages.json']
      },
      {
        name: 'manifest.json',
        assets: ['manifest.json']
      },
      // next three are implemented to have the same name, but theoretically
      { assets: ['a.txt'] },
      { assets: ['b.txt'] },
      { assets: ['foo.png'] },
      { assets: ['popup.html'] },
      { assets: ['devtools.html'] },
      { assets: ['content.js'] },
      { assets: ['content.css'] },
      { assets: ['background.js'] }
    ]);
  });
  // TODO: Test error-checking
  // TODO: Test certain types of plugins fully rather than just one with everything
});

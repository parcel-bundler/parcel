import path from 'path';
import {bundle, assertBundles} from '@parcel/test-utils';

describe('webextension', function() {
  it('should resolve a full webextension bundle', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/webextension/manifest.json'),
    );
    assertBundles(b, [
      {
        name: 'tmp.aff',
        assets: ['tmp.aff'],
      },
      {
        name: 'tmp.dic',
        assets: ['tmp.dic'],
      },
      {
        name: 'messages.json',
        assets: ['messages.json'],
      },
      {
        name: 'manifest.json',
        assets: ['manifest.json'],
      },
      {assets: ['a.txt']},
      {assets: ['b.txt']},
      {assets: ['foo.png']},
      {assets: ['foo-dark.png']},
      {assets: ['popup.html']},
      {assets: ['devtools.html']},
      {assets: ['content.js']},
      {assets: ['content.css']},
      {assets: ['background.js']},
    ]);
  });
  // TODO: Test error-checking
});

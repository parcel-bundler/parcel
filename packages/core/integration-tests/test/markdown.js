import assert from 'assert';
import path from 'path';
import {bundle, assertBundles, outputFS, distDir} from '@parcel/test-utils';

describe.only('markdown', function() {
  it('should support bundling Markdown', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/markdown/index.md'),
    );

    await assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.md'],
      },
      {
        type: 'png',
        assets: ['100x100.png'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf8',
    );
    assert(html.includes('<h1 id="heading1">heading1</h1>'));
  });
});

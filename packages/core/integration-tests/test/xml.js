import {assertBundles, bundle} from '@parcel/test-utils';
import path from 'path';

describe('xml', function() {
  it('should detect xml-stylesheet processing instructions', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/xml-stylesheet-processing-instruction/index.html',
      ),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'xml',
        assets: ['styled.xml'],
      },
      {
        type: 'css',
        assets: ['style1.css'],
      },
      {
        type: 'css',
        assets: ['style3.css'],
      },
    ]);
  });
});

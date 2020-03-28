import { bundle, assertBundles } from '@parcel/test-utils';

describe('jsonld', function() {
  it('Should parse a LD+JSON schema and collect dependencies', async function() {
    let b = await bundle(__dirname + '/integration/schema-jsonld/index.html', {
      production: true,
      publicURL: 'https://place.holder/',
    });
    
    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'css',
        assets: ['other.css']
      },
      {
        type: 'js',
        assets: ['index.html']
      },
      {
        type: 'png',
        assets: ['logo.png']
      },
      {
        type: 'jpeg',
        assets: ['image.jpeg']
      }
    ]);
  });
});

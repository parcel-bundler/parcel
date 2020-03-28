import { bundle, assertBundles } from '@parcel/test-utils';
var assert = require('assert');

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
        type: 'jsonld',
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

  it('Should output the original json back into the index.html file inside the script tag', async function() {
    let b = await bundle(__dirname + '/integration/schema-jsonld/index.html', {
      production: true,
      publicURL: 'https://place.holder/',
    });

    let v1JSONLDOutputInsideScriptTag = {
      "@context": "http://schema.org",
      "@type": "LocalBusiness",
      "description": "This is your business description.",
      "name": "Parcel's parcel",
      "telephone": "555-111-2345",
      "openingHours": "Mo,Tu,We,Th,Fr 09:00-17:00",
      "logo": {
          "@type": "ImageObject",
          "url": "images/logo.png",
          "width": 180,
          "height": 120
        },
      "image": ["images/image.jpeg", "images/image.jpeg"]
    };

    // I need to assert that the current (v2) output is the same as the v1 output
    // aka, is there a test util that can be used to grab onto the transformed output?
    
    assert.ok(false);
  });
});

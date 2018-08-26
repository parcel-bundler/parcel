const {bundle, assertBundleTree} = require('./utils');

describe('schema ld+json', function() {
  it('Should parse a LD+JSON schema and collect dependencies', async function() {
    let b = await bundle(__dirname + '/integration/schema-jsonld/index.html', {
      production: true,
      publicURL: 'https://place.holder/'
    });

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'jpeg'
        },
        {
          type: 'png'
        },
        {
          type: 'css'
        }
      ]
    });
  });
});

const assert = require('assert');
const {bundle, run, assertBundleTree} = require('./utils');

describe('schema ld+json', function() {
  it('Should parse a LD+JSON schema and collect dependencies', async function() {
    let b = await bundle(__dirname + '/integration/schema-jsonld/index.html');

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'jpeg'
        },
        {
          type: 'png'
        }
      ]
    });
  });
});

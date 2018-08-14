const assert = require('assert');
const terserTransformer = require('../src/terser-transformer');
const Path = require('path');

describe('uglify', function() {
  it('should minify code', async function() {
    let dummyModule = {
      code: `
        function helloworld() {
          return 1 + 1;
        }

        console.log(helloworld());
      `,
      name: Path.join(__dirname, 'index.js')
    };

    let parcelOptions = {};

    let result = await terserTransformer.transform(
      dummyModule, 
      await terserTransformer.getConfig(dummyModule, parcelOptions), 
      parcelOptions
    );

    assert(!result[0].code.includes('helloworld'));
    assert(result[0].map === null);
  });
});

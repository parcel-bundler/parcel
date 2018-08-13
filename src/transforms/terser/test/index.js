const assert = require('assert');
const terserTransformer = require('../src/terser-transformer');

describe('uglify', function() {
  it('should minify code', async function() {
    let dummyModule = {
      code: `
        function helloworld() {
          return 1 + 1;
        }

        console.log(helloworld());
      `
    };

    let result = await terserTransformer.generate(dummyModule, {});

    assert(!result.code.includes('helloworld'));
    assert(result.map === null);
  });
});

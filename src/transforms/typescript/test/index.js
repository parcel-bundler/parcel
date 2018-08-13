const assert = require('assert');
const Path = require('path');
const typescriptTransformer = require('../src/typescript-transformer');

describe('typescript', function() {
  it('should process a typescript module', async function() {
    let dummyModule = {
      code: `
        function helloworld(count: number) {
          return 1 + count;
        }

        console.log(helloworld(5));
      `,
      name: Path.join(__dirname, 'index.ts'),
      relativeName: './index.ts'
    };

    let result = await typescriptTransformer.generate(dummyModule, {});
    
    assert(!result.code.includes('number'));
    assert(result.map === null);
  });
});

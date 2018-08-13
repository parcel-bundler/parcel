const Pipeline = require('../src/Pipeline');

const pipeline = new Pipeline({});

describe('Pipeline', function () {
  it('should transform some shit', async function () {
    let transformers = [require('@parcel/transform-terser')];
    let dummyModule = {
      type: 'js',
      code: `
        function helloworld() {
          return 1 + 1;
        }

        console.log(helloworld());
      `
    };

    let result = await pipeline.runPipeline(dummyModule, transformers);
    console.log(result);
  });

  it('should transform some shitty typescript', async function () {
    let transformers = [require('@parcel/transform-typescript'), require('@parcel/transform-terser')];
    let dummyModule = {
      type: 'ts',
      code: `
        function helloworld(count: number) {
          return 1 + count;
        }

        console.log(helloworld(5));
      `,
      name: __dirname + '/index.ts',
      relativeName: './index.ts'
    };

    let result = await pipeline.runPipeline(dummyModule, transformers);
    console.log(result);
  });
});

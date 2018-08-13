const Pipeline = require('../src/Pipeline');

const pipeline = new Pipeline({});

describe('Pipeline', function () {
  it('should transform some shit', async function () {
    let transformers = [require('@parcel/transform-terser')];
    let dummyModule = {
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
});

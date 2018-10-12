// const TransformerRunner = require('../src/TransformerRunner');

// const config = require('@parcel/config-default');
// const runner = new TransformerRunner({
//   parcelConfig: config,
//   cliOpts: {}
// });

// describe('TransformerRunner', function () {
//   it('should transform some shit', async function () {
//     let dummyAsset = {
//       filePath: __dirname + '/index.js',
//       code: `
//         function helloworld() {
//           return 1 + 1;
//         }

//         console.log(helloworld());
//       `
//     };

//     let result = await runner.transform(dummyAsset);
//     console.log(result);
//   });

//   it('should transform some shitty typescript', async function () {
//     let dummyAsset = {
//       filePath: __dirname + '/index.ts',
//       code: `
//         var x = require('y');
//         function helloworld(count: number) {
//           return 1 + count;
//         }

//         console.log(helloworld(5));
//       `
//     };

//     let result = await runner.transform(dummyAsset);
//     console.log(result);
//   });
// });

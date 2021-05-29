const Benchmark = require("tiny-benchy");
const crypto = require('crypto');
const {Hash, hashString, hashBuffer} = require('./');
const {XXHash3} = require('xxhash-addon');

const suite = new Benchmark(500);

suite.add("md5", async () => {
  crypto
    .createHash('md5')
    .update('hello world')
    .digest('hex');
});

suite.add("hashString", () => {
  hashString('hello world');
});

let hash = new XXHash3(0);
suite.add("xxhash-addon", () => {
  hash.hash(Buffer.from('hello world')).toString('hex');
});

// suite.add("hashBuffer", () => {
//   hashBuffer(Buffer.from('hello world'));
// });

// suite.add("object", () => {
//   let h = new Hash;
//   h.writeString('hello world');
//   h.finish();
// });

// suite.add("xxhash-addon object", () => {
//   let hash = new XXHash3(0);
//   hash.update(Buffer.from('hello world'));
//   hash.digest().toString('hex');
// });

suite.run();

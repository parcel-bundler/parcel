const Benchmark = require('tiny-benchy');
const crypto = require('crypto');
const rust = require('./index.js');
const wasm = require('./browser.js');

const suite = new Benchmark(10000);

suite.add('md5 crypto', () => {
  crypto
    .createHash('md5')
    .update('hello world')
    .digest('hex');
});

suite.add('hashString small rust', () => {
  rust.hashString('hello world');
});

suite.add('hashString small wasm', () => {
  wasm.hashString('hello world');
});

suite.add('hashString large rust', () => {
  rust.hashString('hello world'.repeat(10000));
});

suite.add('hashString large wasm', () => {
  wasm.hashString('hello world'.repeat(10000));
});

suite.add('hashBuffer small rust', () => {
  rust.hashBuffer(Buffer.from('hello world'));
});

suite.add('hashBuffer small wasm', () => {
  wasm.hashBuffer(Buffer.from('hello world'));
});

suite.add('hashBuffer large rust', () => {
  rust.hashBuffer(Buffer.alloc(100000));
});

suite.add('hashBuffer large wasm', () => {
  wasm.hashBuffer(Buffer.alloc(100000));
});

suite.add('object small rust', () => {
  let h = new rust.Hash();
  h.writeBuffer(Buffer.from('hello'));
  h.writeBuffer(Buffer.from('hello'));
  h.writeBuffer(Buffer.from('hello'));
  h.writeBuffer(Buffer.from('hello'));
  h.writeBuffer(Buffer.from('hello'));
  h.writeString('hello world');
  h.finish();
});

suite.add('object small wasm', () => {
  let h = new wasm.Hash();
  h.writeBuffer(Buffer.from('hello'));
  h.writeBuffer(Buffer.from('hello'));
  h.writeBuffer(Buffer.from('hello'));
  h.writeBuffer(Buffer.from('hello'));
  h.writeBuffer(Buffer.from('hello'));
  h.writeString('hello world');
  h.finish();
});

suite.add('object big rust', () => {
  let h = new rust.Hash();
  h.writeBuffer(Buffer.alloc(100000));
  h.writeString('hello world');
  h.finish();
});

suite.add('object big wasm', () => {
  let h = new wasm.Hash();
  h.writeBuffer(Buffer.alloc(100000));
  h.writeString('hello world');
  h.finish();
});

wasm.init.then(() => {
  suite.run();
});

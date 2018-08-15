const assert = require('assert');
const Cache = require('../src/Cache');
const Path = require('path');
const { rimraf } = require('@parcel/test-utils');
const md5 = require('@parcel/utils/md5');
const clone = require('clone');

const MOCK_FILE = `
const someModule = require('./something');

module.exports = function() {
  someModule();
}
`;
const MOCK_PATH = 'index.js';
const CACHE_PATH = Path.join(__dirname, '.parcel-cache');

describe('cache-v2', function () {
  beforeEach(async function() {
    await rimraf(CACHE_PATH)
  });

  const CACHE_ENTRY = {
    hash: md5(MOCK_FILE),
    children: [
      {
        hash: md5('// hello world'),
        code: '// hello world',
        map: '{}',
        type: 'js'
      },
      {
        hash: md5('// not hello world'),
        code: '// not hello world',
        map: {},
        type: 'js'
      }
    ],
    results: [
      {
        hash: md5('// hello world'),
        code: '// hello world',
        map: '{}',
        type: 'js'
      },
      {
        hash: md5('// not hello world'),
        code: '// not hello world',
        map: {},
        type: 'js'
      }
    ]
  }

  it('Should write a cache entry', async function () {
    let cacheInstance = new Cache({
      cacheDir: CACHE_PATH
    });

    let cacheEntry = clone(CACHE_ENTRY);
    cacheEntry = await cacheInstance.writeBlobs(cacheEntry);

    for (let child of cacheEntry.children) {
      assert(!child.map.includes('{'));
      assert(!child.code.includes('hello world'));
    }

    for (let result of cacheEntry.results) {
      assert(!result.map.includes('{'));
      assert(!result.code.includes('hello world'));
    }

    await cacheInstance.write(MOCK_PATH, cacheEntry);
  });

  it('Should read a cache entry', async function () {
    let cacheInstance = new Cache({
      cacheDir: CACHE_PATH
    });

    let cacheEntry = clone(CACHE_ENTRY);
    cacheEntry = await cacheInstance.writeBlobs(cacheEntry);

    for (let child of cacheEntry.children) {
      assert(!child.map.includes('{'));
      assert(!child.code.includes('hello world'));
    }

    for (let result of cacheEntry.results) {
      assert(!result.map.includes('{'));
      assert(!result.code.includes('hello world'));
    }

    await cacheInstance.write(MOCK_PATH, cacheEntry);

    cacheEntry = await cacheInstance.read(MOCK_PATH);

    for (let child of cacheEntry.children) {
      assert(!child.map.includes('{'));
      assert(!child.code.includes('hello world'));
    }

    for (let result of cacheEntry.results) {
      assert(!result.map.includes('{'));
      assert(!result.code.includes('hello world'));
    }
  });
});
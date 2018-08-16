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

  after(async function() {
    await rimraf(CACHE_PATH)
  });

  const CACHE_ENTRY = {
    hash: md5(MOCK_FILE),
    children: [
      {
        hash: md5('// hello world'),
        type: 'js',
        blobs: {
          code: '// hello world',
          map: '{}'
        }
      },
      {
        hash: md5('// not hello world'),
        type: 'js',
        blobs: {
          code: '// not hello world',
          map: {
            hey: 'hey'
          }
        }
      },
      {
        hash: md5('// some random buffer'),
        type: 'js',
        blobs: {
          code: '// some random buffer',
          buffer: new Buffer('hello world')
        }
      }
    ],
    results: [
      {
        hash: md5('// hello world'),
        type: 'js',
        blobs: {
          code: '// hello world',
          map: {
            hey: 'hey'
          }
        }
      },
      {
        hash: md5('// not hello world'),
        type: 'js',
        blobs: {
          code: '// not hello world',
          map: '{}'
        }
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
      if (child.blobs.map) {
        assert(!child.blobs.map.includes('{'));
      }
      assert(!child.blobs.code.includes('hello world'));
    }

    for (let result of cacheEntry.results) {
      if (result.blobs.map) {
        assert(!result.blobs.map.includes('{'));
      }
      assert(!result.blobs.code.includes('hello world'));
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
      if (child.blobs.map) {
        assert(!child.blobs.map.includes('{'));
      }
      assert(!child.blobs.code.includes('hello world'));
    }

    for (let result of cacheEntry.results) {
      if (result.blobs.map) {
        assert(!result.blobs.map.includes('{'));
      }
      assert(!result.blobs.code.includes('hello world'));
    }

    await cacheInstance.write(MOCK_PATH, cacheEntry);

    cacheEntry = await cacheInstance.read(MOCK_PATH);

    assert(!cacheEntry.children[0].blobs.map.includes('{'));
    assert(!cacheEntry.children[0].blobs.code.includes('hello world'));

    await cacheInstance.readBlobs(cacheEntry.children[0]);

    assert.equal(typeof cacheEntry.children[0].blobs.map, 'string');
    assert.equal(typeof cacheEntry.children[0].blobs.code, 'string');

    assert(!cacheEntry.children[1].blobs.map.includes('{'));
    assert(!cacheEntry.children[1].blobs.code.includes('hello world'));

    await cacheInstance.readBlobs(cacheEntry.children[1]);
    
    assert.equal(typeof cacheEntry.children[1].blobs.map, 'object');
    assert.equal(typeof cacheEntry.children[1].blobs.code, 'string');

    await cacheInstance.readBlobs(cacheEntry.children[2]);
    
    assert.equal(typeof cacheEntry.children[2].blobs.code, 'string');
    assert(Buffer.isBuffer(cacheEntry.children[2].blobs.buffer));
  });
});
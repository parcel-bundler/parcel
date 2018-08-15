const assert = require('assert');
const fs = require('@parcel/fs');
const Cache = require('../src/Cache');
const Path = require('path');
const { sleep, rimraf, ncp } = require('@parcel/test-utils');
const Dependency = require('@parcel/core-v2/src/Dependency');
const Asset = require('@parcel/core-v2/src/Asset');
const md5 = require('@parcel/utils/md5');

const MOCK_FILE = `
const someModule = require('./something');

module.exports = function() {
  someModule();
}
`;
const MOCK_PATH = 'index.js';
const CACHE_PATH = Path.join(__dirname, '.parcel-cache');

describe('cache-v2', function () {
  it('Should write a cache entry', async function () {
    let cacheInstance = new Cache({
      cacheDir: CACHE_PATH
    });

    let CacheEntry = {
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

    await cacheInstance.write(MOCK_PATH, CacheEntry);

    return filePath;
  });
});
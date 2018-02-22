const assert = require('assert');
const path = require('path');
const rimraf = require('rimraf');
const fs = require('../src/utils/fs');
const promisify = require('../src/utils/promisify');
const {sleep, calculateTestKey} = require('./utils');
const ncp = promisify(require('ncp'));
const FSCache = require('../src/FSCache');

const getMTime = async file => {
  const stat = await fs.stat(file);
  const mtime = stat.mtime.getTime();
  return mtime;
};

describe('FSCache', function() {
  beforeEach(function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.currentTest)}`;
    let cacheDir = __dirname + `/.cache/${calculateTestKey(this.currentTest)}`;
    rimraf.sync(cacheDir);
    rimraf.sync(inputDir);
  });

  it('should create directory on ensureDirExists', async function() {
    let cacheDir = __dirname + `/.cache/${calculateTestKey(this.test)}`;
    let exists = await fs.exists(cacheDir);
    assert(!exists);

    const cache = new FSCache({cacheDir});
    await cache.ensureDirExists();

    exists = await fs.exists(cacheDir);
    assert(exists);
  });

  it('should cache resources', async function() {
    let cacheDir = __dirname + `/.cache/${calculateTestKey(this.test)}`;
    const cache = new FSCache({cacheDir});
    await cache.write(__filename, {a: 'test', b: 1, dependencies: []});

    let cached = await cache.read(__filename);
    assert.equal(cached.a, 'test');
    assert.equal(cached.b, 1);
  });

  it('should return null for invalidated resources', async function() {
    let cacheDir = __dirname + `/.cache/${calculateTestKey(this.test)}`;
    const cache = new FSCache({cacheDir});
    cache.invalidate(__filename);

    let cached = await cache.read(__filename);
    assert.equal(cached, null);
  });

  it('should remove file on delete', async function() {
    let cacheDir = __dirname + `/.cache/${calculateTestKey(this.test)}`;
    let cache = new FSCache({cacheDir});
    await cache.write(__filename, {a: 'test', b: 1, dependencies: []});
    await cache.delete(__filename);

    let cached = await cache.read(__filename);
    assert.equal(cached, null);
  });

  it('should remove from invalidated on write', async function() {
    let cacheDir = __dirname + `/.cache/${calculateTestKey(this.test)}`;
    const cache = new FSCache({cacheDir});
    cache.invalidate(__filename);

    assert(cache.invalidated.has(__filename));

    await cache.write(__filename, {a: 'test', b: 1, dependencies: []});

    assert(!cache.invalidated.has(__filename));
  });

  it('should include mtime for dependencies included in parent', async function() {
    let cacheDir = __dirname + `/.cache/${calculateTestKey(this.test)}`;
    const cache = new FSCache({cacheDir});
    const mtime = await getMTime(__filename);

    await cache.write(__filename, {
      a: 'test',
      b: 1,
      dependencies: [
        {
          includedInParent: true,
          name: __filename
        },
        {
          name: __filename
        }
      ]
    });

    const cached = await cache.read(__filename);
    assert.equal(cached.dependencies[0].mtime, mtime);
    assert.equal(cached.dependencies[1].mtime, undefined);
  });

  it('should invalidate when dependency included in parent changes', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    let cacheDir = __dirname + `/.cache/${calculateTestKey(this.test)}`;

    const cache = new FSCache({cacheDir});
    await ncp(__dirname + '/integration/fs', inputDir);
    const filePath = path.join(inputDir, 'test.txt');

    await cache.write(__filename, {
      dependencies: [
        {
          includedInParent: true,
          name: filePath
        }
      ]
    });

    // update dependency
    // OS X rounds stats.mtime to seconds, delay 1sec
    await sleep(1000);
    await fs.writeFile(filePath, 'world');

    const cached = await cache.read(__filename);
    assert.equal(cached, null);
  });

  it('should return null on read error', async function() {
    let cacheDir = __dirname + `/.cache/${calculateTestKey(this.test)}`;
    const cache = new FSCache({cacheDir});
    const cached = await cache.read(
      path.join(__dirname, '/does/not/exist.txt')
    );

    assert.equal(cached, null);
  });

  it('should continue without throwing on write error', async function() {
    let cacheDir = __dirname + `/.cache/${calculateTestKey(this.test)}`;
    const cache = new FSCache({cacheDir});
    const filePath = path.join(__dirname, '/does/not/exist.txt');

    assert.doesNotThrow(async () => {
      await cache.write(__filename, {
        dependencies: [
          {
            includedInParent: true,
            name: filePath
          }
        ]
      });
    });
  });
});

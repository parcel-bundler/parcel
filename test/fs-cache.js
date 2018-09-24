const assert = require('assert');
const path = require('path');
const fs = require('../src/utils/fs');
const {sleep, rimraf, ncp} = require('./utils');
const FSCache = require('../src/FSCache');

const cachePath = path.join(__dirname, '.cache');
const inputPath = path.join(__dirname, '/input');

const getMTime = async file => {
  const stat = await fs.stat(file);
  const mtime = stat.mtime.getTime();
  return mtime;
};

describe('FSCache', () => {
  beforeEach(async () => {
    await rimraf(cachePath);
    await rimraf(inputPath);
  });

  it('should create directory on ensureDirExists', async () => {
    let exists = await fs.exists(cachePath);
    assert(!exists);

    const cache = new FSCache({cacheDir: cachePath});
    await cache.ensureDirExists();

    exists = await fs.exists(cachePath);
    assert(exists);
  });

  it('should cache resources', async () => {
    const cache = new FSCache({cacheDir: cachePath});
    await cache.write(__filename, {a: 'test', b: 1, dependencies: []});

    let cached = await cache.read(__filename);
    assert.equal(cached.a, 'test');
    assert.equal(cached.b, 1);
  });

  it('should return null for invalidated resources', async () => {
    const cache = new FSCache({cacheDir: cachePath});
    cache.invalidate(__filename);

    let cached = await cache.read(__filename);
    assert.equal(cached, null);
  });

  it('should remove file on delete', async () => {
    let cache = new FSCache({cacheDir: cachePath});
    await cache.write(__filename, {a: 'test', b: 1, dependencies: []});
    await cache.delete(__filename);

    let cached = await cache.read(__filename);
    assert.equal(cached, null);
  });

  it('should remove from invalidated on write', async () => {
    const cache = new FSCache({cacheDir: cachePath});
    cache.invalidate(__filename);

    assert(cache.invalidated.has(__filename));

    await cache.write(__filename, {a: 'test', b: 1, dependencies: []});

    assert(!cache.invalidated.has(__filename));
  });

  it('should include mtime for dependencies included in parent', async () => {
    const cache = new FSCache({cacheDir: cachePath});
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

  it('should invalidate when dependency included in parent changes', async () => {
    const cache = new FSCache({cacheDir: cachePath});
    await ncp(path.join(__dirname, '/integration/fs'), inputPath);
    const filePath = path.join(inputPath, 'test.txt');

    await cache.write(__filename, {
      dependencies: [
        {
          includedInParent: true,
          name: filePath
        }
      ]
    });

    // delay and update dependency
    await sleep(1000);
    await fs.writeFile(filePath, 'world');

    const cached = await cache.read(__filename);
    assert.equal(cached, null);
  });

  it('should return null on read error', async () => {
    const cache = new FSCache({cacheDir: cachePath});
    const cached = await cache.read(
      path.join(__dirname, '/does/not/exist.txt')
    );

    assert.equal(cached, null);
  });

  it('should continue without throwing on write error', async () => {
    const cache = new FSCache({cacheDir: cachePath});
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

  it('should invalidate cache if a wildcard dependency changes', async () => {
    const cache = new FSCache({cacheDir: cachePath});
    const wildcardPath = path.join(inputPath, 'wildcard');
    await fs.mkdirp(wildcardPath);
    await ncp(path.join(__dirname, '/integration/fs'), wildcardPath);
    const filePath = path.join(wildcardPath, 'test.txt');

    await cache.write(__filename, {
      dependencies: [
        {
          includedInParent: true,
          name: path.join(wildcardPath, '*')
        }
      ]
    });

    let cached = await cache.read(__filename);
    assert(cached !== null);

    // delay and update dependency
    await sleep(1000);
    await fs.writeFile(filePath, 'world');

    cached = await cache.read(__filename);
    assert.equal(cached, null);
  });
});

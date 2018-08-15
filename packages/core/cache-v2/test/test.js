const assert = require('assert');
const fs = require('@parcel/fs');
const Cache = require('../src/Cache');
const Path = require('path');
const { sleep, rimraf, ncp } = require('@parcel/test-utils');
const Dependency = require('@parcel/core-v2/src/Dependency');
const Asset = require('@parcel/core-v2/src/Asset');

const INPUT_PATH = Path.join(__dirname, 'input');
const INTEGRATION_PATH = Path.join(__dirname, 'integration');
const CACHE_PATH = Path.join(__dirname, '.parcel-cache');
const ASSETS = {
  'index': Path.join(INPUT_PATH, 'basic-js/index.js'),
  'module': Path.join(INPUT_PATH, 'basic-js/module.js'),
  'otherModule': Path.join(INPUT_PATH, 'basic-js/otherModule.js'),
};

describe('cache-v2', function () {
  after(async function () {
    await rimraf(CACHE_PATH);
    await rimraf(INPUT_PATH);
  });

  beforeEach(async function () {
    await rimraf(CACHE_PATH);
    await rimraf(INPUT_PATH);

    let inputFolder = Path.join(INPUT_PATH, 'basic-js');
    await fs.mkdirp(inputFolder);
    await ncp(Path.join(INTEGRATION_PATH, 'basic-js'), inputFolder);
  });

  let cacheInstance;
  async function writeCache() {
    cacheInstance = new Cache({
      cacheDir: CACHE_PATH
    });

    let assets = [];
  
    // index
    assets.push(new Asset({
      parentId: 1,
      id: 3,
      env: {},
      filePath: ASSETS.index,
      code: await fs.readFile(ASSETS.index, 'utf-8'),
      dependencies: [
        new Dependency({
          moduleSpecifier: './otherModule',
          resolvedPath: ASSETS.otherModule
        },
          {
            id: 2,
            env: {}
          })
      ]
    }));
  
    // module
    assets.push(new Asset({
      parentId: 1,
      id: 2,
      env: {},
      filePath: ASSETS.module,
      code: await fs.readFile(ASSETS.module, 'utf-8'),
      dependencies: [
        new Dependency({
          moduleSpecifier: './otherModule',
          resolvedPath: ASSETS.otherModule
        },
          {
            id: 2,
            env: {}
          })
      ]
    }));
  
    let filePath = ASSETS.index;
    await cacheInstance.write(filePath, assets);
  
    return filePath;
  }

  it('Should create a valid cache entry', async function () {
    let filePath = await writeCache();
    let cacheEntry = await cacheInstance.read(filePath);

    assert(!!cacheEntry);
    assert(cacheEntry.subModules.length === 2);
    for (let subModule of cacheEntry.subModules) {
      assert(!!subModule);
      assert.equal(subModule.code, await fs.readFile(subModule.filePath, 'utf-8'));
    }
  });

  it('Should invalidate cache if entryfile changed', async function () {
    let filePath = await writeCache();

    let cacheEntry = await cacheInstance.read(filePath);
    assert(cacheEntry !== null);

    await fs.writeFile(filePath, '// this is a comment');
    await sleep(1000);
    
    cacheEntry = await cacheInstance.read(filePath);
    assert(cacheEntry === null);
  });

  it('Should not invalidate cache if a non included dependency changed', async function () {
    let filePath = await writeCache();

    let cacheEntry = await cacheInstance.read(filePath);
    assert(cacheEntry !== null);

    await fs.writeFile(ASSETS.otherModule, '// this is a comment');
    await sleep(1000);
    
    cacheEntry = await cacheInstance.read(filePath);
    assert(cacheEntry !== null);
  });

  it('Should invalidate cache if a subModule changed', async function () {
    let filePath = await writeCache();

    let cacheEntry = await cacheInstance.read(filePath);
    assert(cacheEntry !== null);

    await fs.writeFile(ASSETS.module, '// this is a comment');
    await sleep(1000);
    
    cacheEntry = await cacheInstance.read(filePath);
    assert(cacheEntry === null);
  });
});
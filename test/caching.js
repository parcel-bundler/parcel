const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {bundle, run, assertBundleTree} = require('./utils');

async function removeCache() {
  let location = path.join(__dirname, '../.cache');

  let exists = await new Promise((resolve, reject) => {
    fs.stat(location, (err, stat) => {
      if (err) {
        resolve(false);
      }
      resolve(true);
    });
  });

  if (!exists) {
    return;
  }

  let files = await new Promise((resolve, reject) => {
    fs.readdir(location, (err, stats) => {
      if (err) {
        return resolve(err);
      }
      resolve(stats);
    });
  });

  await files.forEach(async file => {
    file = `${location}/${file}`;

    await new Promise((resolve, reject) => {
      fs.unlink(file, err => {
        resolve(err);
      });
    });
  });

  await new Promise((resolve, reject) => {
    fs.rmdir(location, err => {
      resolve(err);
    });
  });
}

describe('Cache', function() {
  it('Should not change hash if asset has not changed', async function() {
    await removeCache();

    let bOne = await bundle(__dirname + '/integration/cache/index.js', {
      cache: true
    });
    let hashOne = Array.from(bOne.assets)[0].hash;

    await removeCache();

    let bTwo = await bundle(__dirname + '/integration/cache/index.js', {
      cache: true
    });
    let hashTwo = Array.from(bTwo.assets)[0].hash;

    assert.equal(hashOne, hashTwo);

    await removeCache();
  });

  it('Should change hash if asset has changed', async function() {
    await removeCache();
    let location = __dirname + '/integration/cache/index.js';

    let script = 'module.exports = function () {return 1;};';
    await new Promise((resolve, reject) => {
      fs.writeFile(location, script, err => {
        resolve();
      });
    });

    let bOne = await bundle(location, {cache: true});
    let hashOne = Array.from(bOne.assets)[0].hash;

    await removeCache();

    script = 'module.exports = function () {return 2;};';
    await new Promise((resolve, reject) => {
      fs.writeFile(location, script, err => {
        resolve();
      });
    });

    let bTwo = await bundle(location, {cache: true});
    let hashTwo = Array.from(bTwo.assets)[0].hash;

    assert.notEqual(hashOne, hashTwo);

    await removeCache();
  });

  it('Should change hash if config has changed', async function() {
    await removeCache();
    let location = __dirname + '/integration/cache-config/index.ts';
    let configLocation = __dirname + '/integration/cache-config/tsconfig.json';

    let config = {
      compilerOptions: {
        removeComments: true
      }
    };
    await new Promise((resolve, reject) => {
      fs.writeFile(configLocation, JSON.stringify(config), err => {
        resolve();
      });
    });

    let bOne = await bundle(location, {cache: true});
    let hashOne = Array.from(bOne.assets)[0].hash;

    await removeCache();

    config = {
      compilerOptions: {
        removeComments: false
      }
    };
    await new Promise((resolve, reject) => {
      fs.writeFile(configLocation, JSON.stringify(config), err => {
        resolve();
      });
    });

    let bTwo = await bundle(location, {cache: true});
    let hashTwo = Array.from(bTwo.assets)[0].hash;

    assert.notEqual(hashOne, hashTwo);

    await removeCache();
  });
});

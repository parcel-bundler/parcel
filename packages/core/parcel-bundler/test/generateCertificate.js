const assert = require('assert');
const path = require('path');
const fs = require('@parcel/fs');
const generateCertificate = require('../src/utils/generateCertificate');
const {ncp} = require('@parcel/test-utils');

const cachePath = path.join(__dirname, '.cache');
const inputPath = path.join(__dirname, '/input');

const cacheOptions = {
  cacheDir: cachePath,
  cache: true
};

describe('generateCertificate', () => {
  beforeEach(async () => {
    await fs.rimraf(cachePath);
    await fs.rimraf(inputPath);
  });

  it('should support loading cached certificate', async () => {
    await ncp(path.join(__dirname, '/integration/https'), cachePath);

    const key = await fs.readFile(path.join(cachePath, 'private.pem'));
    const cert = await fs.readFile(path.join(cachePath, 'primary.crt'));

    const generated = generateCertificate(cacheOptions);

    assert.equal(generated.cert.toString(), cert.toString());
    assert.equal(generated.key.toString(), key.toString());
  });

  it('should support caching generated certificate', async () => {
    generateCertificate(cacheOptions);

    assert(await fs.exists(path.join(cachePath, 'private.pem')));
    assert(await fs.exists(path.join(cachePath, 'primary.crt')));
  });
});

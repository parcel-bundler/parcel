const assert = require('assert');
const path = require('path');
const rimraf = require('rimraf');
const fs = require('../src/utils/fs');
const promisify = require('../src/utils/promisify');
const ncp = promisify(require('ncp'));
const generateCertificate = require('../src/utils/generateCertificate');

const cachePath = path.join(__dirname, '.cache');
const inputPath = path.join(__dirname, '/input');

const cacheOptions = {
  cacheDir: cachePath,
  cache: true
};

describe('generateCertificate', () => {
  beforeEach(() => {
    rimraf.sync(cachePath);
    rimraf.sync(inputPath);
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

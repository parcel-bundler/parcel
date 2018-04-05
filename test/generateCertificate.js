const assert = require('assert');
const path = require('path');
const fs = require('../src/utils/fs');
const promisify = require('../src/utils/promisify');
const ncp = promisify(require('ncp'));
const generateCertificate = require('../src/utils/generateCertificate');
const {removeDirectory, tmpPath} = require('./utils');

describe('generateCertificate', () => {
  beforeEach(async () => {
    await removeDirectory(tmpPath('.cache'));
    await removeDirectory(tmpPath('input'));
  });

  it('should support loading cached certificate', async () => {
    await ncp(path.join(__dirname, '/integration/https'), tmpPath('.cache'));

    const key = await fs.readFile(tmpPath('.cache', 'private.pem'));
    const cert = await fs.readFile(tmpPath('.cache', 'primary.crt'));

    const generated = generateCertificate({
      cacheDir: tmpPath('.cache'),
      cache: true
    });

    assert.equal(generated.cert.toString(), cert.toString());
    assert.equal(generated.key.toString(), key.toString());
  });

  it('should support caching generated certificate', async () => {
    generateCertificate({
      cacheDir: tmpPath('.cache'),
      cache: true
    });

    assert(await fs.exists(tmpPath('.cache', 'private.pem')));
    assert(await fs.exists(tmpPath('.cache', 'primary.crt')));
  });
});

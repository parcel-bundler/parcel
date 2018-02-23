const assert = require('assert');
const path = require('path');
const fs = require('../src/utils/fs');
const promisify = require('../src/utils/promisify');
const ncp = promisify(require('ncp'));
const generateCertificate = require('../src/utils/generateCertificate');
const {generateTimeKey} = require('./utils');

describe('generateCertificate', () => {
  it('should support loading cached certificate', async () => {
    const cacheDir = path.join(__dirname, '.cache/', generateTimeKey());
    await ncp(path.join(__dirname, '/integration/https'), cacheDir);

    const key = await fs.readFile(path.join(cacheDir, 'private.pem'));
    const cert = await fs.readFile(path.join(cacheDir, 'primary.crt'));

    const generated = generateCertificate({
      cache: true,
      cacheDir
    });

    assert.equal(generated.cert.toString(), cert.toString());
    assert.equal(generated.key.toString(), key.toString());
  });

  it('should support caching generated certificate', async () => {
    const cacheDir = path.join(__dirname, '.cache/', generateTimeKey());

    generateCertificate({
      cache: true,
      cacheDir
    });

    assert(await fs.exists(path.join(cacheDir, 'private.pem')));
    assert(await fs.exists(path.join(cacheDir, 'primary.crt')));
  });
});

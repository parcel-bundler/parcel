const assert = require('assert');
const path = require('path');
const fs = require('../src/utils/fs');
const getCertificate = require('../src/utils/getCertificate');

const https = {
  key: path.join(__dirname, '/integration/https', 'private.pem'),
  cert: path.join(__dirname, '/integration/https', 'primary.crt')
};

describe('getCertificate', () => {
  it('should support custom certificate', async () => {
    const key = await fs.readFile(
      path.join(__dirname, '/integration/https', 'private.pem')
    );
    const cert = await fs.readFile(
      path.join(__dirname, '/integration/https', 'primary.crt')
    );

    const retrieved = await getCertificate(https);

    assert.equal(retrieved.cert.toString(), cert.toString());
    assert.equal(retrieved.key.toString(), key.toString());
  });
});

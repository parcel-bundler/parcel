const fs = require('./fs');

async function getCertificate(options) {
  try {
    let cert = await fs.readFile(options.cert);
    let key = await fs.readFile(options.key);
    return {key, cert};
  } catch (err) {
    throw new Error('Certificate and/or key not found');
  }
}

module.exports = getCertificate;

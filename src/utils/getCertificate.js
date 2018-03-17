const fs = require('./fs');

async function getCertificate(options) {
  const key =
    (await fs.exists(options.key)) && (await fs.readFile(options.key));
  const cert =
    (await fs.exists(options.cert)) && (await fs.readFile(options.cert));
  if (!key || !cert) {
    throw 'Certificate and/or key not found';
  }
  return {key, cert};
}

module.exports = getCertificate;

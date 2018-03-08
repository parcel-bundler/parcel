const fs = require('fs');

function getCertificate(options) {
  const key = fs.existsSync(options.key) && fs.readFileSync(options.key);
  const cert = fs.existsSync(options.cert) && fs.readFileSync(options.cert);
  if (!key || !cert) {
    throw 'Certificate and/or key not found';
  }
  return {key, cert};
}

module.exports = getCertificate;

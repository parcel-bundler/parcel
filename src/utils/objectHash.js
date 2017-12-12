const crypto = require('crypto');
const canonicalJson = require('canonical-json');

module.exports = function(object) {
  let hash = crypto.createHash('md5');

  // Use canonical JSON to ensure same json returns the exact same string => exact same hash
  hash.update(canonicalJson(object));

  return hash.digest('hex');
};

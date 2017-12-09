const crypto = require('crypto');

module.exports = function(object) {
  let hash = crypto.createHash('md5');
  for (let key of Object.keys(object).sort()) {
    hash.update(key + object[key]);
  }

  return hash.digest('hex');
};

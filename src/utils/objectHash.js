const crypto = require('crypto');

function objectHash(object) {
  let hash = crypto.createHash('md5');
  for (let key of Object.keys(object).sort()) {
    let val = object[key];
    if (typeof val === 'object' && val) {
      hash.update(key + objectHash(val));
    } else {
      hash.update(key + val);
    }
  }

  return hash.digest('hex');
}

module.exports = objectHash;

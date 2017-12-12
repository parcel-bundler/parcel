const crypto = require('crypto');

function recusiveHashGenerator(object, hash) {
  for (let key of Object.keys(object).sort()) {
    let item = object[key];
    if (item) {
      if (typeof item === 'object') {
        hash = recusiveHashGenerator(item, hash);
      }
      hash.update(key + item);
    }
  }
  return hash;
}

module.exports = function(object) {
  let hash = crypto.createHash('md5');

  hash = recusiveHashGenerator(object, hash);

  return hash.digest('hex');
};

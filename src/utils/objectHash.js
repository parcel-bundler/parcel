const crypto = require('crypto');

module.exports = function(object) {
  let hash = crypto.createHash('md5');
  for (let key of Object.keys(object).sort()) {
    let item = object[key];
    if (item) {
      for (let subkey of Object.keys(item).sort()) {
        hash.update(subkey + item[subkey]);
      }
    }
  }

  return hash.digest('hex');
};

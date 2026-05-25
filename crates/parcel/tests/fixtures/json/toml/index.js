var local = require('./local.toml');

module.exports = function () {
  return local.a + local.b.c;
};

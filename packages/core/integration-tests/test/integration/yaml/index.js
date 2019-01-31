var local = require('./local.yaml');

module.exports = function () {
  return local.a + local.b.c;
};

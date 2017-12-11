var local = require('./local.coffee');

module.exports = function () {
  return local.a + local.b.c;
};

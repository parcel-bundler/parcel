var local = require('./symlinked_local');

module.exports = function () {
  return local.a + local.b;
};

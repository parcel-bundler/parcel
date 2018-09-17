var local = require('./local.json');

module.exports = function () {
  return local.a + local.b;
};

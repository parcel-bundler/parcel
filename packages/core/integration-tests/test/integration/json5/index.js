var local = require('./local.json5');

module.exports = function () {
  return local.a + local.b;
};

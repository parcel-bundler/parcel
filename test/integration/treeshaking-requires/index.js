var local = require('./local');

module.exports = function () {
  var res = local.a + local.b;
  return res;
};

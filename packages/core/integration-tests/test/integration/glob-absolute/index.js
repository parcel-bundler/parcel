var vars = require('/some-absolute-dir/*.js');

module.exports = function () {
  return vars.a + vars.b;
};

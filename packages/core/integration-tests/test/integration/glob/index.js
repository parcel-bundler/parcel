var vars = require('./dir/*.js');

module.exports = function () {
  return vars.a + vars.b;
};

var vars = require('./dir/**/*.js');

module.exports = function () {
  return vars.a + vars.b + vars.x.c + vars.x.y.z;
};

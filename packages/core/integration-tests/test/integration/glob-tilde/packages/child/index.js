const childVars = require('~/dir/*.js');

module.expors = function () {
  return childVars.a + childVars.b;
}

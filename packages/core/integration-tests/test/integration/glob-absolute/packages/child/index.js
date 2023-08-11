const rootVars = require('/dir/*.js');

module.expors = function () {
  return rootVars.a + rootVars.b;
}

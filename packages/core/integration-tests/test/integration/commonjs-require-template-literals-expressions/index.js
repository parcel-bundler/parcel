var packageName = 'local';
var local = require(`./${packageName}`);

module.exports = function () {
  return local.a + local.b;
};

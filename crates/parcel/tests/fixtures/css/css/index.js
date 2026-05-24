var local = require('./local');
require('./index.css');

module.exports = function () {
  return local.a + local.b;
};

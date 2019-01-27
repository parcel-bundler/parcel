const local = require('./local');

module.exports = function() {
  return local.a + local.b;
}
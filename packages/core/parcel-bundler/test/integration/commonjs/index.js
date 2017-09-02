var local = require('./local');
var url = require('url');

module.exports = function () {
  return local.a + local.b;
};

var local = require('./local');
// eslint-disable-next-line no-unused-vars
var url = require('url');

module.exports = function () {
  return local.a + local.b;
};

var {a} = require('testmodule');
var {b} = require('./local');

module.exports = function () {
  return a + b;
};

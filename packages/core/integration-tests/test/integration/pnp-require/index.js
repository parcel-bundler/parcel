const {a} = require('testmodule');
const {b} = require('./local.js');

module.exports = function() {
  return a + b;
};

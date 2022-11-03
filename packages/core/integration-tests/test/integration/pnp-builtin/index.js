const {a} = require('module/');
const {b} = require('./local.js');

module.exports = function() {
  return a + b;
};

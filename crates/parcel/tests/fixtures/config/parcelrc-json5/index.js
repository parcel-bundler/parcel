var a = require('./a.data');
var b = require('./b.txt');

module.exports = function () {
  return a.a + b.b;
};

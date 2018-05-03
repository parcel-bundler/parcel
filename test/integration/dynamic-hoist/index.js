var common = require('./common');

var a = import('./a');
var b = import('./b');
var c = import('./c');

module.exports = function () {
  return Promise.all([a, b, c]).then(function ([a, b, c]) {
    return a.a + a.b + b + c;
  });
};

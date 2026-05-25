var common = require('./common');
var a = import('./a');

module.exports = function () {
  return a.then(function (a) {
    return common + a.a + a.b;
  });
};

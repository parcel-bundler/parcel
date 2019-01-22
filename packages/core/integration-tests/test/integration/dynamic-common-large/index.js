var a = import('./a');
var b = import('./b');

module.exports = function () {
  return Promise.all([a, b]).then(function ([a, b]) {
    return a.a + a.b + b;
  });
};

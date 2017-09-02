var local = import('./local');
require('./index.css');

module.exports = function () {
  return local.then(function (l) {
    return l.a + l.b;
  });
};

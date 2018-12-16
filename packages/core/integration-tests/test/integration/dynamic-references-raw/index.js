var local = import('./local');

module.exports = function () {
  return local.then(function (l) {
    return l.a + l.b;
  });
};

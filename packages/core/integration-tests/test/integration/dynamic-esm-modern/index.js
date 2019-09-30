var local = import('./local');

output = function () {
  return local.then(function (l) {
    return l.a + l.b;
  });
};

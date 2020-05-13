const local = import('./local');

output = function () {
  return local.then(function (v) {
    return "Imported: " + v.default;
  });
};

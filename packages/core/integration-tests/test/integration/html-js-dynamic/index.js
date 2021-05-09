const local = import('./local');

global.output = function () {
  return local.then(function (v) {
    return "Imported: " + v.default;
  });
};

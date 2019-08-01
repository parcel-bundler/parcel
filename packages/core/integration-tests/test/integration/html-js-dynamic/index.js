const local = import('./local');

export default function () {
  return local.then(function (v) {
    return "Imported: " + v.default;
  });
};

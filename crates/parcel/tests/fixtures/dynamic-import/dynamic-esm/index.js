var local = import('./local');

export default function () {
  return local.then(function (l) {
    return l.a + l.b;
  });
};

var local = import('./local');

function run() {
  return local.then(function (l) {
    output(l.a + l.b);
  });
};

module.hmrOptions.accept();

run();

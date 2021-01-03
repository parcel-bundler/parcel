var local = require('./local');

function run() {
  output(local.a + local.b);
}

run();

// eslint-disable-next-line no-undef
reportModuleId(module.id);

module.hot.dispose(function () {
  output('dispose-' + module.id);
});

module.hot.accept(function () {
  output('accept-' + module.id);
});

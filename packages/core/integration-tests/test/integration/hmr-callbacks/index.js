var local = require('./local');

function run() {
  output(local.a + local.b);
}

run();

// eslint-disable-next-line no-undef
reportModuleId(module.id);

module.hmrOptions.dispose(function () {
  output('dispose-' + module.id);
});

module.hmrOptions.accept(function () {
  output('accept-' + module.id);
});

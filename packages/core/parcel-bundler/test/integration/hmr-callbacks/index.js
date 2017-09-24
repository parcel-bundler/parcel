var local = require('./local');

function run() {
  output(local.a + local.b);
}

run();

module.hot.dispose(function () {
  output('dispose');
});

module.hot.accept(function () {
  output('accept');
});

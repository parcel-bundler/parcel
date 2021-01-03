var local = require('./local');

function run() {
  output(local.a + local.b);
}

module.hmrOptions.accept();

run();

module.exports = 'value';

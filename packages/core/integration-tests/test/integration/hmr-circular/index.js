var local = require('./local');

function run() {
  output(local.a + local.b);
}

module.hot.accept();

run();

module.exports = 'value';

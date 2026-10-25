function load() {
  const dep = require('./dep-function.js');
  return dep.used;
}

sideEffect(load());

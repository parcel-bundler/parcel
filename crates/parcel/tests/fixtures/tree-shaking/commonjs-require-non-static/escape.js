const dep = require('./dep-escape.js');

function callUnused(mod) {
  return mod.unused();
}

sideEffect(dep.used, callUnused(dep));

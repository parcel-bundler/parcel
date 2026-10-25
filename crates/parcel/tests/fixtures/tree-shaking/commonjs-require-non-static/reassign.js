let dep = require('./dep-reassign.js');

let used = dep.used;
dep = null;
sideEffect(used);

const dep = require('./commonjs-dep.js');
const esm = require('./esm-dep.js');

sideEffect(dep.usedCommonjs, dep['usedComputed'], esm.usedEsm);

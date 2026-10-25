const {used} = require('./dep.js');
const namespace = require('./dep-namespace.js').used;

sideEffect(used, require('./dep.js').usedInline, namespace, Object.keys(require('./dep-namespace.js')));

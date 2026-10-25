const dep = require('./dep-computed.js');

let key = 'un' + 'used';
sideEffect(dep.used, dep[key]());

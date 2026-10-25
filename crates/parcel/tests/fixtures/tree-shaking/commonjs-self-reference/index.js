const {used, usedThis} = require('./dep.js');

output = [...used(), usedThis];

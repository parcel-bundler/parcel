let b = require('./b');
let b2 = require('./b');
sideEffect([b, b2]);
b = 4;
sideEffect([b, b2]);

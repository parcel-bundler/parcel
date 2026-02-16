let b = require('./b').foo;
let b2 = require('./b').foo;
sideEffect([b, b2]);
b = 4;
sideEffect([b, b2]);

let b = require('./b').foo;
let b2 = require('./b').foo;
output([b, b2]);
b = 4;
output([b, b2]);

let x = require('./other');
let prop = 'fo' + 'o';
x[prop] = 4;
let res = require('./other').foo;
output = res;

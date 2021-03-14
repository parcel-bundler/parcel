let x = require('./other');
x['fo' + 'o'] = 4;
let res = require('./other').foo;
output = res;

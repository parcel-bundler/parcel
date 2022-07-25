let {foo} = require('./b');
let {foo: foo2} = require('./b');
output([foo, foo2]);
foo = 4;
output([foo, foo2]);

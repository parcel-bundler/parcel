let {foo} = require('./b');
let {foo: foo2} = require('./b');
sideEffect([foo, foo2]);
foo = 4;
sideEffect([foo, foo2]);

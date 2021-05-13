var foo = require('./b').foo;
var setFoo = require('./b').setFoo;

output(foo);
setFoo(3);
output(foo);

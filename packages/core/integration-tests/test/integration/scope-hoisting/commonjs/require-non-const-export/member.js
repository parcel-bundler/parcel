var foo = require('./b').foo;
var setFoo = require('./b').setFoo;

sideEffect(foo);
setFoo(3);
sideEffect(foo);

var {foo, setFoo} = require('./b');

sideEffect(foo);
setFoo(3);
sideEffect(foo);

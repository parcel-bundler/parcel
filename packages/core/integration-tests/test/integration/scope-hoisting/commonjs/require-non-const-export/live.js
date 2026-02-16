var b = require('./b');

sideEffect(b.foo);
b.setFoo(3);
sideEffect(b.foo);

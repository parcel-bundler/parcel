const external = require('external');

output(external.foo);
external.setFoo(2);
output(external.foo);

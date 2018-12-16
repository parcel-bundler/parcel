var b = require('./b');

b.setFoo(3);
module.exports = b.foo + b['bar'];

import b from './dep.js';
var foo1 = b.foo;
var foo2 = require('./dep.js').foo;
output = foo1 + foo2;

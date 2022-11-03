function test() {
  b = 4;
}

let b = require('./b');
let b2 = require('./b');
output([b, b2]);
test();
output([b, b2]);

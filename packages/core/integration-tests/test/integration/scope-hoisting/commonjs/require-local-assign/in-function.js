function test() {
  b = 4;
}

let b = require('./b');
let b2 = require('./b');
sideEffect([b, b2]);
test();
sideEffect([b, b2]);

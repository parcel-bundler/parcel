output('a');

function x() {
  return require('./b');
}

output('c');
x();

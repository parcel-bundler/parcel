output('a');

function x() {
  return require('./b');
}

output('d');
x();

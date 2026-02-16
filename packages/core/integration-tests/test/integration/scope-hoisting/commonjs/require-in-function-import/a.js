sideEffect('a');

function x() {
  return require('./b');
}

sideEffect('d');
x();

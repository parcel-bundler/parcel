sideEffect('a');

function x() {
  return require('./b');
}

sideEffect('c');
x();

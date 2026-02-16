sideEffect('a');

if (globalThis.b) {
  require('./b');
}

sideEffect('d');

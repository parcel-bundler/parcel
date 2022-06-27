function before() {
  sideEffect('before');
  return 'before';
}

function after() {
  sideEffect('after');
  return 'after';
}

output = before() + ' ' + require('./require') + ' ' + after();

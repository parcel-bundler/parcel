const Local = require('./Local');

export function count() {
  let local = new Local(1, 2);
  return local.a + local.b;
}
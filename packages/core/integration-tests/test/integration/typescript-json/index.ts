const local = require('./local.json');

export function count() {
  return local.a + local.b;
}
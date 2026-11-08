import * as lib from './lib.js';

const before = lib.live;
lib.increment();
output = [
  Object.keys(lib).sort().join(),
  Object.getPrototypeOf(lib) === null || Object.getPrototypeOf(lib) === Object.prototype,
  lib.first,
  lib.second,
  lib['__proto__'],
  lib['dashed-name'],
  before,
  lib.live,
];

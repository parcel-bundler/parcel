import polyfills from 'node-libs-browser';
import {builtinModules} from 'module';

const empty = require.resolve('./_empty.js');

let builtins = Object.create(null);
// use definite (current) list of Node builtins
for (let key of builtinModules) {
  builtins[key] = empty;
}
// load the polyfill where available
for (let key in polyfills) {
  builtins[key] = polyfills[key] || empty;
}

export default builtins;

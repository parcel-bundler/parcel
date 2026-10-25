import * as ns from './dep-namespace.js';

function callAll(namespace) {
  return Object.keys(namespace).sort().map(key => namespace[key]);
}

let values = callAll(ns);
sideEffect(ns.usedNamespace, values[0](), values[1]);

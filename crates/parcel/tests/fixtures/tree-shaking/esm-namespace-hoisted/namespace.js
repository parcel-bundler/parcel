function getUsed() {
  return ns.usedNamespace;
}

sideEffect(getUsed());

import * as ns from './dep-namespace.js';

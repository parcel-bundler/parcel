import * as ns from './dep-namespace.js';

let key = 'unused' + 'Namespace';
sideEffect(ns.usedNamespace, ns[key]());

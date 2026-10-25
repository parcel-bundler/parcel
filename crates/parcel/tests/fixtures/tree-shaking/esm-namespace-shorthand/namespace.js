import * as ns from './dep-namespace.js';

let wrapper = {ns};
sideEffect(ns.usedNamespace, wrapper.ns.unusedNamespace());

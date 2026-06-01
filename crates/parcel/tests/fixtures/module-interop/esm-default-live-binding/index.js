import foo, { change } from './dep.js';
sideEffect(typeof foo);
change(10);
sideEffect(foo);

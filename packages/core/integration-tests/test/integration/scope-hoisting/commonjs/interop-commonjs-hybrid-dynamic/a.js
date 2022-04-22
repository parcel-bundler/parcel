import b from './b';
export const foo = b.foo; // <-- missing default interop
export const bar = (() => require('./b').foo)();

output = foo + bar;

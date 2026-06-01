import { foo as cFoo } from './c.js';
export * from './c.js';
export function foo() { return 'fooB:' + cFoo(); }

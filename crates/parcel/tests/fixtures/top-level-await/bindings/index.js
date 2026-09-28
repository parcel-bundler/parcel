import {a, c, Foo, i, counter, inc} from './values.js';
inc();
sideEffect([a, c, typeof Foo, new Foo().value, i, counter]);

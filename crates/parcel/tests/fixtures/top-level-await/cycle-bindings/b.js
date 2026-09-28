import {hello, counter, Foo} from './index.js';
sideEffect(hello());
try {
  counter;
} catch (err) {
  sideEffect(err.name);
}
try {
  Foo;
} catch (err) {
  sideEffect(err.name);
}

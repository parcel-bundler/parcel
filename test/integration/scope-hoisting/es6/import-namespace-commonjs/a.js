import {foo} from './c';

module.exports = import('./b').then(function (b) {
  return foo + b.foo;
});


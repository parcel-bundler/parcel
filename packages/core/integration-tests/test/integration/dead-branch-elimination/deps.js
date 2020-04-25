import {a} from 'a';

const foo = () => {
  if (process.browser) {
    return 'foo'
  } else {
    return a();
  }
}

output = foo;
module.exports = foo;

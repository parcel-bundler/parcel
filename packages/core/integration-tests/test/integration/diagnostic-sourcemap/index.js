// @flow

type Test = {|
  foo: string
|};

let test: Test = {
	foo: 'hi'
};

import foo from 'foo';

console.log(test);

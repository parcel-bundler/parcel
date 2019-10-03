import * as other from './other';

type Params = {
  hello: other.Params;
};

// export class Test {}

export default function test(params: Params) {
  return params.hello;
}

export function foo() {
  return 2;
}

var x = 2;
var p = x + 2, q = 3;
export {p as hi};
// export {Test as Hello} from './other';
// export * from './other';

export {default as a} from './other';
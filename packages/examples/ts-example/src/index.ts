type Params = {
  hello: string;
};

export class Test {}

export default function test(params: Params) {
  return params.hello;
}

export function foo() {
  return 2;
}

var x = 2;
var p = x + 2, q = 3;
export {p};
export {Test} from './other';

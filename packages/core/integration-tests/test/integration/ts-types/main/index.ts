type Params = {
  hello: number;
};

interface Hello {
  yo: string;
}

export class Test {
  test(hello: Hello) {
    return hello.yo;
  }
}

export default function test(params: Params) {
  return params.hello;
}

export function foo() {
  return 2;
}

var x = 2;
var p = x + 2, q = 3;
export {p as hi, x};

export module mod {
  export function bar() {
    return 2;
  }
}
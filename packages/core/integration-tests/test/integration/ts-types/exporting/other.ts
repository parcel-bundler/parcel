export interface Test {
  foo: number;
}

export interface Params {
  bar: number;
}

export var a = 2, b = 5;
export default function (p: Params) {
  return p.bar;
}

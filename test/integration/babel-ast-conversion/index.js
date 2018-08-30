// @flow

type T = 0;
type A = B<*>;

const hello = () => {
  return 'this is an arrow function';
};

async () => {
  for await (i of []) {
    // Do something I guess...
  }
}

let { x, y, ...c } = obj;
let [...l] = something;

let helloSpread = {...{
  one: 1
}}

let helloArray = [...[]];

var a: { [a: number]: string; };

class C<+T,-U> {}
function f<+T,-U>() {}
type T<+T,-U> = {}
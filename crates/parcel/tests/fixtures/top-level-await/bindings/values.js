export const {a, b: [c]} = await Promise.resolve({a: 1, b: [2]});
export class Foo {
  value = 'foo';
}
for (var i = 0; i < 3; i++) {}
export {i};
export let counter = 0;
export function inc() {
  counter++;
}

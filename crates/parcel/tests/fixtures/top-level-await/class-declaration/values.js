await 0;
export class Foo {
  static self() {
    return Foo;
  }
}
const Original = Foo;
Foo = null;
export const selfReference = Original.self() === Original;

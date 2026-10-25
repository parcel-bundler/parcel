function first() {
  sideEffect("first(): factory evaluated");
  return function (target, propertyKey, descriptor) {
    sideEffect("first(): called");
  };
}

function second() {
  sideEffect("second(): factory evaluated");
  return function (target, propertyKey, descriptor) {
    sideEffect("second(): called");
  };
}

class ExampleClass {
  @first()
  @second()
  method() {}
}

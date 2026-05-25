function first() {
  sideEffect("first(): factory evaluated");
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    sideEffect("first(): called");
  };
}

function second() {
  sideEffect("second(): factory evaluated");
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    sideEffect("second(): called");
  };
}

class ExampleClass {
  @first()
  @second()
  method() {}
}

function first() {
  output("first(): factory evaluated");
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    output("first(): called");
  };
}

function second() {
  output("second(): factory evaluated");
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    output("second(): called");
  };
}

class ExampleClass {
  @first()
  @second()
  method() {}
}

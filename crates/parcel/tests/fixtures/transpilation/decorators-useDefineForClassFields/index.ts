function log() {
  return function (target: any, key: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    descriptor.value = function (...args: any[]) {
      sideEffect(key);
      return original.apply(this, args);
    };
    return descriptor;
  };
}

class MyClass {
  @log()
  greet() {
    return 'hello';
  }
}

const obj = new MyClass();
obj.greet();

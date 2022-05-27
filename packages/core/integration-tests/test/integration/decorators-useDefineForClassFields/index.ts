class LoggerClass {
  @logger()
  foo = 5;
}

function logger() {
  return function (proto, originalKey) {
    const privateKey = `__${originalKey}`;
    Object.defineProperty(proto, originalKey, {
      get() {
        output(`${originalKey} ${this[privateKey]}`);
        return this[privateKey];
      },
      set(value) {
        this[privateKey] = 10 + value;
      },
    });
  };
}

const instance = new LoggerClass();
instance.foo;
instance.foo = 6;
instance.foo;

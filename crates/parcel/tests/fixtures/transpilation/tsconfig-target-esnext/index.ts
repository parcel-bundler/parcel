class Base {
  set value(value: number) {
    throw new Error('class fields should be defined, not assigned');
  }
}

class Derived extends Base {
  value = 1;
}

module.exports = function () {
  return Object.getOwnPropertyDescriptor(new Derived(), 'value')?.value;
};

import foo from 'foo';

// Useless class to test babel
class Test {
  constructor(value) {
    this.value = value;
  }
}

export default new Test(foo).value;

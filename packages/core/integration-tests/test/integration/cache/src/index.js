import test from './nested/test';
import foo from 'foo';

class Result {
  constructor(value) {
    this.value = value;
  }
}

module.exports = new Result(test + foo).value;

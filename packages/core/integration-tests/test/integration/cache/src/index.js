import test from './nested/test';

class Result {
  constructor(value) {
    this.value = value;
  }
}

module.exports = new Result(test + 2).value;

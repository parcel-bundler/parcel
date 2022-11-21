import componentFunc from '../component/ts'

class Test {
  classProperty = 2;
  #privateProperty;

  constructor(text, func) {
    this.#privateProperty = text + ':' + func();
  }

  get() {
    return this.#privateProperty;
  }
}

export default new Test('REPLACE_ME', componentFunc).get();

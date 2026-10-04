interface Hi {
  test: string
}

class Test {
  classProperty = 2;
  #privateProperty;

  constructor(text) {
    this.#privateProperty = text;
  }

  get() {
    return this.#privateProperty;
  }
}

export default new Test('REPLACE_ME').get();

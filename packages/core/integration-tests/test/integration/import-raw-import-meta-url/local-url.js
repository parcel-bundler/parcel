class URL {
  toString(){
    return "test.js";
  }
}

export default new URL("./invalid.js", import.meta.url);

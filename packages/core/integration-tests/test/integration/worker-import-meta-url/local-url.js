class URL {
  toString(){
    return "test.js";
  }
}

new Worker(new URL("./invalid.js", import.meta.url));

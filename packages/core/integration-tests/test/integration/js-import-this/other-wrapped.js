import * as ns from "./other-wrapped.js";

let y = typeof module !== "undefined" ? module : {};

export function returnThis() {
  if (y != null) {
    return [this === undefined, this === ns];
  } else {
    throw new Error();
  }
}

export default returnThis;

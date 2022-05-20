import * as ns from "./other.js";

export function returnThis() {
  return [this === undefined, this === ns];
}

export default returnThis;

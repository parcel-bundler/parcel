import a, { set } from "./other.js";

let oldValue = a;
set(789);
let newValue = a;

export default [oldValue, newValue]

import { hashString } from "../hash.mjs";
export function test() {
  return "hi";
}
export function test2(obj) {
  return new Function('return ' + hashString(obj.a.b));
}

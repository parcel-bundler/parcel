import { log as logFn1 } from "./other1";
import { log as logFn2 } from "./other2";

export function log(f: typeof logFn1 | typeof logFn2) {
  logFn1("1");
  logFn2(1);
}

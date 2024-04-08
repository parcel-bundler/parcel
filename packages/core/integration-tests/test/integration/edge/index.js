import library from "./library";
import process from "process";

output({
  global: Buffer.from("abc").toString("hex"),
  builtin: process.cwd(),
  browserResolution: library
});

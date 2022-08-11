import library from "./library";
import process from "process";

module.exports = {
  global: Buffer.from("abc").toString("hex"),
  builtin: process.cwd(),
  browserResolution: library
}

/*
  This file sets up the benchmark runner. The built-in test runner is unstable
*/

#![allow(unused)]

#[path = "src/lib.rs"]
mod lib;

fn main() {
  divan::main();
}

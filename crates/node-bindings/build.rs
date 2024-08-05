#[cfg(not(target_arch = "wasm32"))]
extern crate napi_build;

fn main() {
  #[cfg(target_env = "musl")]
  println!("cargo::rustc-link-arg=-lpthread");

  #[cfg(not(target_arch = "wasm32"))]
  napi_build::setup();
}

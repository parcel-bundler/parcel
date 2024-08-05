#[cfg(not(target_arch = "wasm32"))]
extern crate napi_build;

fn main() {
  #[cfg(not(target_arch = "wasm32"))]
  napi_build::setup();
}
